#define NATIVE_FN(name) int name(void)

NATIVE_FN(get_version) { return 1; }

int use_it(void) { return get_version(); }

int plain_func(void) { return 42; }
