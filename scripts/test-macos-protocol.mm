#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#include <cstdio>
#include <cassert>
#include <cstring>
#include <initializer_list>
int main(int argc, char **argv) {
  const bool unsafe = argc == 2 && strcmp(argv[1], "--reproduce-unsafe") == 0;
  @autoreleasepool {
    auto cls = objc_allocateClassPair([NSResponder class], "StillProtocolProbe", 0);
    for (const char* name : {"NSTouchBarProvider", "NSApplicationDelegate"}) {
      Protocol *p = objc_getProtocol(name);
      // The unsafe option preserves the upstream calls for crash diagnosis.
      // The default exercises the guarded calls used by the patched runtime.
      fprintf(stderr, "add %s: %p => %d\n", name, p,
              unsafe || p ? class_addProtocol(cls, p) : 0);
    }
    objc_registerClassPair(cls);
    id instance = [[cls alloc] init];
    unsigned int count = 0;
    Protocol *__unsafe_unretained *protocols = class_copyProtocolList(cls, &count);
    for (unsigned int i = 0; i < count; ++i) {
      fprintf(stderr, "class protocol %p\n", protocols[i]);
      if (!unsafe) assert(protocols[i] != nullptr);
    }
    free(protocols);
    for (int i = 0; i < 1000000; ++i) {
      for (const char* name : {"NSTouchBarProvider", "NSApplicationDelegate", "WKNavigationDelegate", "NSObject"}) {
        Protocol *p = objc_getProtocol(name);
        if (i == 0) fprintf(stderr, "conforms %s %p -> %d\n", name, p, [instance conformsToProtocol:p]);
        else [instance conformsToProtocol:p];
      }
    }
    [instance release];
    fprintf(stderr, "PASS: 4,000,000 protocol conformance checks\n");
  }
}
