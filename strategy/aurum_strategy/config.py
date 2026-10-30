"""Igor's trading rules and the strategy parameters, in one place."""

# 1 pip = 0.10 USD on XAU/USD (Igor's convention, same as the dashboard).
PIP = 0.1

# Stop-loss cap per session, in pips, using the dashboard's UTC session hours.
SL_CAP_ASIA_LONDON = 30
SL_CAP_NY = 50
# Structural stops tighter than this are noise on M5; widen them to the minimum.
SL_MIN = 10
# Extra room beyond the swept wick before the stop.
STOP_BUFFER = 3

# Take-profit ladder in pips. TP1 moves the stop to break-even.
TP1, TP2, TP3 = 20, 50, 80

# A trade still open after this long is closed at its best rung reached (or 0 if none).
MAX_HOLD_HOURS = 24

# Profile: price bucket size and value-area share.
PROFILE_BIN = 0.5          # USD per bucket (5 pips)
VALUE_AREA = 0.70
# A node is "dominated" by one side when that side has at least this share of its activity.
STRONG_SIDE = 0.70

# Fibonacci levels of the previous day's range (0 = high, 1 = low), as on the indicator.
FIB_LEVELS = (0.236, 0.382, 0.5, 0.618, 0.65, 0.786, 0.886)
OTE_ZONE = (0.618, 0.786)

# Rejection: how far price must pierce a level, and how many confluences a signal needs.
PIERCE = 0.2               # USD (2 pips)
CONFLUENCE_RADIUS = 1.5    # USD (15 pips): other levels this close count as confluence
MIN_SCORE = 2
