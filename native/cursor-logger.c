#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <time.h>

// Wall clock (ms since the Unix epoch), deliberately NOT CLOCK_MONOTONIC.
// The renderer aligns these stamps against timestamps taken in Node, and macOS
// CLOCK_MONOTONIC stops during system sleep while libuv's hrtime does not — the
// two epochs drift apart by however long the machine has slept since boot
// (measured at ~21s on this machine). Wall clock is the same epoch as
// Date.now() in Node, and NTP skew over a recording is irrelevant.
static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

int main(int argc, char **argv) {
    int hz = argc > 1 ? atoi(argv[1]) : 250;
    if (hz < 30) hz = 30;
    useconds_t us = 1000000 / hz;
    setvbuf(stdout, NULL, _IOFBF, 1 << 16);
    fprintf(stderr, "cursor-logger: %d Hz\n", hz);
    int prevL = -1, prevR = -1;
    double lastFlush = now_ms();
    while (1) {
        // CGEventCreate returns a +1 retained ref — must release it, or a
        // 250Hz loop leaks thousands of events over a single recording.
        CGEventRef ev = CGEventCreate(NULL);
        CGPoint loc = CGEventGetLocation(ev);
        CFRelease(ev);
        int l = CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft);
        int r = CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonRight);
        double t = now_ms();
        printf("{\"t\":%.3f,\"x\":%.2f,\"y\":%.2f,\"l\":%d,\"r\":%d}\n",
               t, loc.x, loc.y, l, r);
        // Flush on any button transition (so clicks are never stuck in the
        // buffer if we're killed) and otherwise at ~10Hz to bound data loss.
        if (l != prevL || r != prevR || t - lastFlush > 100.0) {
            fflush(stdout);
            lastFlush = t;
            prevL = l;
            prevR = r;
        }
        usleep(us);
    }
}
