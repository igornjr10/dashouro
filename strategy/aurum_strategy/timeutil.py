"""UTC <-> New York clock without tzdata (Windows has no IANA database by default)."""
from datetime import datetime, timedelta, timezone

HOUR = 3_600_000
DAY = 24 * HOUR


def _nth_sunday(year: int, month: int, n: int) -> datetime:
    d = datetime(year, month, 1, tzinfo=timezone.utc)
    d += timedelta(days=(6 - d.weekday()) % 7)  # first Sunday
    return d + timedelta(weeks=n - 1)


def ny_offset_hours(t_ms: int) -> int:
    """-4 during US daylight time (2nd Sunday of March 02:00 to 1st Sunday of November 02:00 local), else -5."""
    year = datetime.fromtimestamp(t_ms / 1000, timezone.utc).year
    start = _nth_sunday(year, 3, 2) + timedelta(hours=7)   # 02:00 EST = 07:00 UTC
    end = _nth_sunday(year, 11, 1) + timedelta(hours=6)    # 02:00 EDT = 06:00 UTC
    t = datetime.fromtimestamp(t_ms / 1000, timezone.utc)
    return -4 if start <= t < end else -5


def ny_time(t_ms: int) -> datetime:
    """Naive datetime on the New York wall clock."""
    return datetime.fromtimestamp(t_ms / 1000, timezone.utc).replace(tzinfo=None) + timedelta(hours=ny_offset_hours(t_ms))


def utc_hour(t_ms: int) -> int:
    return datetime.fromtimestamp(t_ms / 1000, timezone.utc).hour


def utc_day(t_ms: int) -> int:
    """Start of the UTC day in ms (Exness server time is GMT+0, so this matches broker daily candles)."""
    return t_ms // DAY * DAY


def brt(t_ms: int) -> str:
    """Brasília wall clock (UTC-3, no daylight saving since 2019)."""
    return (datetime.fromtimestamp(t_ms / 1000, timezone.utc) - timedelta(hours=3)).strftime("%d/%m %H:%M")


def session(t_ms: int) -> str:
    """Dashboard sessions in UTC: Asia 21-07, London 07-13, New York 13-21."""
    h = utc_hour(t_ms)
    return "ny" if 13 <= h < 21 else "london" if 7 <= h < 13 else "asia"


def killzone(t_ms: int) -> str | None:
    """ICT forex killzones on the New York clock: London 02-05, New York AM 07-10."""
    t = ny_time(t_ms)
    m = t.hour * 60 + t.minute
    if 2 * 60 <= m < 5 * 60:
        return "london"
    if 7 * 60 <= m < 10 * 60:
        return "ny"
    return None
