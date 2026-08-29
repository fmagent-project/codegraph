#define NATIVE_FN(name) int name(void)

NATIVE_FN(get_version_cpp) { return 1; }

int use_it_cpp(void) { return get_version_cpp(); }

int plain_func_cpp(void) { return 42; }
