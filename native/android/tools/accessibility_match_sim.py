"""
Pure-JVM simulation (in Python) of MainActivity.isAccessibilityEnabled() matching logic.

Replicates android.content.ComponentName semantics:
  - ComponentName(context, Class)   -> ComponentName(pkg=applicationId, cls=Class.getName())
  - ComponentName.unflattenFromString("pkg/cls")
        * if cls starts with '.', expand to pkg + cls
        * returns None for malformed / empty input
  - equality: pkg == pkg AND cls == cls
"""

APP_ID = "com.cryptoconex.mobile"  # applicationId / namespace from build.gradle.kts
SERVICE_CLASS = "com.cryptoconex.mobile.service.CryptoConexAccessibilityService"  # Class.getName()

# ComponentName(this, CryptoConexAccessibilityService::class.java)
EXPECTED = (APP_ID, SERVICE_CLASS)


def unflatten_from_string(s):
    """Mimic ComponentName.unflattenFromString(). Returns (pkg, cls) or None."""
    if s is None:
        return None
    sep = s.find('/')
    if sep < 0 or sep + 1 >= len(s):
        return None
    pkg = s[:sep]
    cls = s[sep + 1:]
    if not pkg:
        return None
    if cls.startswith('.'):
        cls = pkg + cls  # Android expands leading '.' with the package
    return (pkg, cls)


def is_accessibility_enabled(enabled_setting, instance_not_null=False):
    """Replicates isAccessibilityEnabled()."""
    if instance_not_null:
        return True
    if enabled_setting is None:
        return False
    for token in enabled_setting.split(':'):
        if unflatten_from_string(token) == EXPECTED:
            return True
    return False


cases = [
    ("com.cryptoconex.mobile/com.cryptoconex.mobile.service.CryptoConexAccessibilityService", True),
    ("com.cryptoconex.mobile/.service.CryptoConexAccessibilityService", True),
    ("com.browserling.ime/com.browserling.ime.BrowserlingAccessibilityService:"
     "com.cryptoconex.mobile/com.cryptoconex.mobile.service.CryptoConexAccessibilityService", True),
    ("", False),
    (None, False),
]

if __name__ == "__main__":
    all_ok = True
    for setting, expected in cases:
        got = is_accessibility_enabled(setting)
        ok = got == expected
        all_ok = all_ok and ok
        print(f"[{'PASS' if ok else 'FAIL'}] input={setting!r:90} expected={expected} got={got}")
    print("\nEXPECTED ComponentName:", EXPECTED)
    print("ALL PASS" if all_ok else "SOME FAILED")
    import sys
    sys.exit(0 if all_ok else 1)
