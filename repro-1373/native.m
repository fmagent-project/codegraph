#define NATIVE_FN(name) int name(void)

NATIVE_FN(get_version_objc) { return 1; }

int use_it_objc(void) { return get_version_objc(); }
