# ORYH Client plugin

This directory publishes `@oryh/dsh-client`, with a Host loader entry, browser `./client` module and `dsh.client` dependency manifest. There is no standalone page or HTTP server.

The ORYH Bundle disables the default layout. This plugin provides the sole `root` and public `ctx.layout` service: business navigation and the native sidebar on the left, root-scoped `oryh.business` in the center, and the native session-maybe `conversation` on the right. Native `rightbar` remains a session-scoped overlay; `shell.overlay` is retained. No private Harness source or conversation component is imported.

Root geometry uses a Harness `defineStore`. Business pages remain mounted across navigation and chat visibility changes, independently of Session selection. Narrow screens switch between business and chat. Saved drafts remain encrypted on the Host; refresh and unload clear unsaved edits.

Generated Remote descriptors mount through the public Gateway and wait for `remote.oryh`. Business components receive that transport. Locale, theme, styles and slot registrations are lifecycle-owned, and Fluent portals mount under the business root.

The current upstream renderer has a root-gap error during development hot replacement. The Profile disables `client-hmr`; save drafts, stop the server, build and restart when upgrading. Normal plugin unload/re-register is covered by public SlotCore/Cordis lifecycle tests.

Chat-driven queries and fields are not enabled. The native conversation is the only chat; this package sends no business context to Sessions or model tools. See [migration](../../docs/14-dsh-plugin-migration.md).
