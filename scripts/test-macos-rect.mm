#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <objc/message.h>
#include <cassert>
#include <cstdio>
#include <cstring>

// A non-UI regression for the two CGRect-returning Cocoa message signatures.
// No NSApplication or NSWindow is created.
@interface StillRectABIProbe : NSObject
- (CGRect)frame;
- (CGRect)contentRectForFrameRect:(CGRect)rect;
@end

@implementation StillRectABIProbe
- (CGRect)frame { return CGRectMake(13, 17, 1180, 760); }
- (CGRect)contentRectForFrameRect:(CGRect)rect {
  return CGRectMake(rect.origin.x + 2, rect.origin.y + 3,
                    rect.size.width - 4, rect.size.height - 5);
}
@end

int main(int argc, char **argv) {
  const bool unsafe = argc == 2 && strcmp(argv[1], "--reproduce-unsafe") == 0;
  @autoreleasepool {
    id probe = [StillRectABIProbe new];
    using GetRect = CGRect (*)(id, SEL);
    using TransformRect = CGRect (*)(id, SEL, CGRect);
    GetRect getRect;
    TransformRect transformRect;
    #if defined(__x86_64__)
    getRect = unsafe ? (GetRect)objc_msgSend : (GetRect)objc_msgSend_stret;
    transformRect = unsafe ? (TransformRect)objc_msgSend : (TransformRect)objc_msgSend_stret;
    #else
    (void)unsafe;
    getRect = (GetRect)objc_msgSend;
    transformRect = (TransformRect)objc_msgSend;
    #endif
    CGRect rect = getRect(probe, @selector(frame));
    assert(rect.origin.x == 13 && rect.origin.y == 17);
    assert(rect.size.width == 1180 && rect.size.height == 760);
    CGRect content = transformRect(probe, @selector(contentRectForFrameRect:), rect);
    assert(content.origin.x == 15 && content.origin.y == 20);
    assert(content.size.width == 1176 && content.size.height == 755);
    [probe release];
    puts("PASS: CGRect getter and CGRect argument/return dispatch");
  }
}
