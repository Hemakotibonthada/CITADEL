"""
CITADEL — Shared Memory Ring Buffer

Lock-free ring buffer implementation using multiprocessing.shared_memory.
Provides sub-millisecond IPC between Data Ingester, Strategy Engine, and UI Bridge.

Architecture:
    [Header: 64 bytes] [Data Slots: N * item_size bytes]
    
    Header layout:
      - write_index (int64): Next write position (monotonically increasing)
      - read_index  (int64): Consumer read position
      - capacity    (int64): Number of slots
      - item_size   (int64): Size of each item in bytes
      - flags       (int64): Control flags (active, paused, etc.)
      - reserved    (24 bytes): Future use
"""

from __future__ import annotations

import struct
import time
from multiprocessing import shared_memory
from typing import Any

import numpy as np

from src.core.models import TICK_DTYPE, SIGNAL_DTYPE, RISK_DTYPE, PORTFOLIO_DTYPE

# Header format: 5 int64s + 24 bytes padding = 64 bytes
HEADER_FORMAT = "=5q24x"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)

# Control flags
FLAG_ACTIVE = 1 << 0
FLAG_PAUSED = 1 << 1
FLAG_OVERFLOW = 1 << 2


class RingBuffer:
    """
    Lock-free single-producer single-consumer (SPSC) ring buffer
    backed by OS shared memory.
    
    Designed for sub-millisecond data transfer between processes.
    Uses memory-mapped NumPy arrays for zero-copy reads.
    """

    def __init__(
        self,
        name: str,
        dtype: np.dtype,
        capacity: int = 65536,
        create: bool = True,
    ):
        """
        Initialize a shared memory ring buffer.

        Args:
            name: Unique shared memory segment name
            dtype: NumPy dtype for buffer items
            capacity: Number of slots (power of 2 recommended)
            create: True to create, False to attach to existing
        """
        self._name = name
        self._dtype = dtype
        self._capacity = capacity
        self._item_size = dtype.itemsize
        self._total_size = HEADER_SIZE + (capacity * self._item_size)

        if create:
            # Clean up any existing segment
            try:
                existing = shared_memory.SharedMemory(name=name, create=False)
                existing.close()
                existing.unlink()
            except FileNotFoundError:
                pass

            self._shm = shared_memory.SharedMemory(
                name=name, create=True, size=self._total_size
            )
            # Initialize header
            self._write_header(0, 0, capacity, self._item_size, FLAG_ACTIVE)
        else:
            self._shm = shared_memory.SharedMemory(name=name, create=False)
            _, _, capacity, item_size, _ = self._read_header()
            self._capacity = capacity
            self._item_size = item_size

        # Create NumPy view of data area (zero-copy)
        self._data = np.ndarray(
            shape=(self._capacity,),
            dtype=self._dtype,
            buffer=self._shm.buf[HEADER_SIZE:],
        )

    def _write_header(
        self,
        write_idx: int,
        read_idx: int,
        capacity: int,
        item_size: int,
        flags: int,
    ) -> None:
        """Write header atomically."""
        struct.pack_into(
            HEADER_FORMAT, self._shm.buf, 0,
            write_idx, read_idx, capacity, item_size, flags,
        )

    def _read_header(self) -> tuple[int, int, int, int, int]:
        """Read header atomically."""
        return struct.unpack_from(HEADER_FORMAT, self._shm.buf, 0)

    @property
    def write_index(self) -> int:
        return struct.unpack_from("q", self._shm.buf, 0)[0]

    @write_index.setter
    def write_index(self, value: int) -> None:
        struct.pack_into("q", self._shm.buf, 0, value)

    @property
    def read_index(self) -> int:
        return struct.unpack_from("q", self._shm.buf, 8)[0]

    @read_index.setter
    def read_index(self, value: int) -> None:
        struct.pack_into("q", self._shm.buf, 8, value)

    @property
    def flags(self) -> int:
        return struct.unpack_from("q", self._shm.buf, 32)[0]

    @flags.setter
    def flags(self, value: int) -> None:
        struct.pack_into("q", self._shm.buf, 32, value)

    @property
    def available(self) -> int:
        """Number of unread items."""
        return self.write_index - self.read_index

    @property
    def free_slots(self) -> int:
        """Number of writable slots."""
        return self._capacity - self.available

    @property
    def is_full(self) -> bool:
        return self.available >= self._capacity

    @property
    def is_empty(self) -> bool:
        return self.available == 0

    def write(self, item: np.void | dict[str, Any]) -> bool:
        """
        Write a single item to the ring buffer.
        
        Returns:
            True if successful, False if buffer is full.
        """
        if self.is_full:
            # Overflow: set flag and overwrite oldest
            self.flags = self.flags | FLAG_OVERFLOW
            self.read_index = self.read_index + 1

        idx = self.write_index % self._capacity

        if isinstance(item, dict):
            for field_name in self._dtype.names:
                if field_name in item:
                    self._data[idx][field_name] = item[field_name]
        else:
            self._data[idx] = item

        self.write_index = self.write_index + 1
        return True

    def write_batch(self, items: np.ndarray) -> int:
        """
        Write multiple items to the ring buffer.
        
        Returns:
            Number of items written.
        """
        n = len(items)
        if n == 0:
            return 0

        wi = self.write_index
        for i in range(n):
            idx = (wi + i) % self._capacity
            self._data[idx] = items[i]

        self.write_index = wi + n

        # Handle overflow
        if self.available > self._capacity:
            self.read_index = self.write_index - self._capacity
            self.flags = self.flags | FLAG_OVERFLOW

        return n

    def read(self) -> np.void | None:
        """
        Read a single item from the ring buffer.
        
        Returns:
            Item data or None if buffer is empty.
        """
        if self.is_empty:
            return None

        idx = self.read_index % self._capacity
        item = self._data[idx].copy()
        self.read_index = self.read_index + 1
        return item

    def read_batch(self, max_items: int = 0) -> np.ndarray:
        """
        Read multiple items from the ring buffer.
        
        Args:
            max_items: Maximum items to read (0 = all available).
            
        Returns:
            NumPy array of items.
        """
        avail = self.available
        if avail == 0:
            return np.empty(0, dtype=self._dtype)

        n = min(avail, max_items) if max_items > 0 else avail
        ri = self.read_index
        
        result = np.empty(n, dtype=self._dtype)
        for i in range(n):
            idx = (ri + i) % self._capacity
            result[i] = self._data[idx]

        self.read_index = ri + n
        return result

    def peek(self, offset: int = 0) -> np.void | None:
        """Peek at an item without consuming it."""
        if offset >= self.available:
            return None
        idx = (self.read_index + offset) % self._capacity
        return self._data[idx].copy()

    def peek_latest(self, count: int = 1) -> np.ndarray:
        """Peek at the most recent items without consuming."""
        avail = self.available
        if avail == 0:
            return np.empty(0, dtype=self._dtype)
        
        n = min(count, avail)
        wi = self.write_index
        result = np.empty(n, dtype=self._dtype)
        for i in range(n):
            idx = (wi - n + i) % self._capacity
            result[i] = self._data[idx]
        return result

    def get_snapshot(self, count: int = 0) -> np.ndarray:
        """
        Get a snapshot of buffer data without modifying read position.
        Useful for UI rendering.
        """
        avail = self.available
        if avail == 0:
            return np.empty(0, dtype=self._dtype)
        
        n = min(count, avail) if count > 0 else avail
        ri = self.read_index
        
        result = np.empty(n, dtype=self._dtype)
        for i in range(n):
            idx = (ri + i) % self._capacity
            result[i] = self._data[idx]
        return result

    def clear(self) -> None:
        """Reset buffer to empty state."""
        self.read_index = self.write_index
        self.flags = self.flags & ~FLAG_OVERFLOW

    def close(self) -> None:
        """Close shared memory (do not unlink)."""
        self._shm.close()

    def destroy(self) -> None:
        """Close and unlink (delete) shared memory."""
        self._shm.close()
        try:
            self._shm.unlink()
        except FileNotFoundError:
            pass

    def __repr__(self) -> str:
        return (
            f"RingBuffer(name={self._name!r}, capacity={self._capacity}, "
            f"available={self.available}, dtype={self._dtype})"
        )

    def __del__(self) -> None:
        try:
            self._shm.close()
        except Exception:
            pass


class SharedMemoryManager:
    """
    Central manager for all shared memory segments.
    Creates and manages ring buffers for different data types.
    """

    def __init__(self, config: dict[str, Any] | None = None):
        self._config = config or {}
        self._buffers: dict[str, RingBuffer] = {}
        self._capacity = self._config.get("ring_buffer_slots", 65536)

    def create_all(self) -> None:
        """Create all standard ring buffers."""
        self._buffers["ticks"] = RingBuffer(
            name=self._config.get("tick_buffer_name", "citadel_ticks"),
            dtype=TICK_DTYPE,
            capacity=self._capacity,
            create=True,
        )
        self._buffers["signals"] = RingBuffer(
            name=self._config.get("signal_buffer_name", "citadel_signals"),
            dtype=SIGNAL_DTYPE,
            capacity=self._capacity // 4,
            create=True,
        )
        self._buffers["risk"] = RingBuffer(
            name=self._config.get("risk_buffer_name", "citadel_risk"),
            dtype=RISK_DTYPE,
            capacity=4096,
            create=True,
        )
        self._buffers["portfolio"] = RingBuffer(
            name=self._config.get("portfolio_buffer_name", "citadel_portfolio"),
            dtype=PORTFOLIO_DTYPE,
            capacity=4096,
            create=True,
        )

    def attach_all(self) -> None:
        """Attach to existing shared memory segments (consumer side)."""
        self._buffers["ticks"] = RingBuffer(
            name=self._config.get("tick_buffer_name", "citadel_ticks"),
            dtype=TICK_DTYPE,
            create=False,
        )
        self._buffers["signals"] = RingBuffer(
            name=self._config.get("signal_buffer_name", "citadel_signals"),
            dtype=SIGNAL_DTYPE,
            create=False,
        )
        self._buffers["risk"] = RingBuffer(
            name=self._config.get("risk_buffer_name", "citadel_risk"),
            dtype=RISK_DTYPE,
            create=False,
        )
        self._buffers["portfolio"] = RingBuffer(
            name=self._config.get("portfolio_buffer_name", "citadel_portfolio"),
            dtype=PORTFOLIO_DTYPE,
            create=False,
        )

    def get_buffer(self, name: str) -> RingBuffer:
        """Get a ring buffer by name."""
        if name not in self._buffers:
            raise KeyError(f"Buffer '{name}' not found. Available: {list(self._buffers.keys())}")
        return self._buffers[name]

    @property
    def tick_buffer(self) -> RingBuffer:
        return self._buffers["ticks"]

    @property
    def signal_buffer(self) -> RingBuffer:
        return self._buffers["signals"]

    @property
    def risk_buffer(self) -> RingBuffer:
        return self._buffers["risk"]

    @property
    def portfolio_buffer(self) -> RingBuffer:
        return self._buffers["portfolio"]

    def status(self) -> dict[str, dict[str, Any]]:
        """Get status of all buffers."""
        return {
            name: {
                "available": buf.available,
                "free_slots": buf.free_slots,
                "capacity": buf._capacity,
                "is_full": buf.is_full,
                "overflow": bool(buf.flags & FLAG_OVERFLOW),
            }
            for name, buf in self._buffers.items()
        }

    def destroy_all(self) -> None:
        """Destroy all shared memory segments."""
        for buf in self._buffers.values():
            buf.destroy()
        self._buffers.clear()

    def close_all(self) -> None:
        """Close all shared memory segments."""
        for buf in self._buffers.values():
            buf.close()
        self._buffers.clear()

    def __repr__(self) -> str:
        return f"SharedMemoryManager(buffers={list(self._buffers.keys())})"
