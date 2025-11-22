# WASM 3.0 Compatibility Review

This document tracks the compatibility status and upgrade path for php-wasm with modern WebAssembly features and Emscripten toolchain updates.

## Current Configuration

### Emscripten Version
- **Active Version**: 3.1.67
- **Custom Fork**: `seanmorris/emscripten` branch `sm-updates`
- **Known Working**: 3.1.43, 3.1.44
- **Known Issues**: 3.1.45+ has CloudFlare Workers compatibility problems

### Critical Build Flags (Makefile:386-427)

| Flag | Value | Purpose | Status |
|------|-------|---------|--------|
| `ASYNCIFY` | 1 | Async PHP execution | Active - consider JSPI migration |
| `MAIN_MODULE` | 1 | Dynamic library loading | Active |
| `SIDE_MODULE` | 1 | Extension compilation | Active |
| `MODULARIZE` | 1 | ES6 module output | Active |
| `ALLOW_MEMORY_GROWTH` | 1 | Dynamic heap | Active |
| `FORCE_FILESYSTEM` | - | Always include FS API | Active |
| `ERROR_ON_UNDEFINED_SYMBOLS` | 0 | Flexible linking | Active |
| `AUTO_NATIVE_LIBRARIES` | 0 | Manual library control | Active |
| `AUTO_JS_LIBRARIES` | 0 | Manual JS lib control | Active |

### Memory Configuration

```
INITIAL_MEMORY = 128MB
MAXIMUM_MEMORY = 4096MB
TOTAL_STACK = 32MB
```

### Exported Functions

```javascript
EXPORTED_FUNCTIONS = ["_malloc", "_free", "_main"]
EXPORTED_RUNTIME_METHODS = ["ccall", "UTF8ToString", "lengthBytesUTF8",
                            "stringToUTF8", "getValue", "setValue", "FS", "ENV"]
```

## Custom Emscripten Fork Analysis

The project uses a custom fork at `seanmorris/emscripten` branch `sm-updates`. This section documents the changes and their purpose.

### Fork Changes (6 commits)

1. **IDBFS Permissions Fix** (`src/library_idbfs.js`)
   - Ignores file permissions during sync operations
   - Prevents permission-related errors in browser IndexedDB

2. **Dynamic Linking Console Fix** (`system/lib/libc/dynlink.c`)
   - Replaces `emscripten/console.h` with standard `printf`
   - Fixes SIDE_MODULE compilation issues

3. **Preload Target Path Fix** (`tools/link.py`)
   - Fixes preload data target path generation
   - Ensures assets are correctly located in the virtual filesystem

### Testing with Stock Emscripten

The dockerfile supports a build argument to test with stock Emscripten:

```bash
# Build Docker image with stock Emscripten (no custom fork)
docker build --build-arg USE_STOCK_EMSCRIPTEN=1 \
  -t php-emscripten-builder:stock -f emscripten-builder.dockerfile .

# Build Docker image with custom fork (default)
docker build -t php-emscripten-builder:custom -f emscripten-builder.dockerfile .

# Then test with stock Emscripten:
# (Update docker-compose.yaml to use php-emscripten-builder:stock)
make clean
make web-mjs PHP_VERSION=8.4

# Run tests to verify functionality:
make test-node PHP_VERSION=8.4
```

### Key Areas to Test with Stock Emscripten

1. **IDBFS sync** - File persistence in browser
2. **Dynamic extension loading** - `.so` file loading works
3. **Asset preloading** - Virtual filesystem has correct paths

## Emscripten Upgrade Considerations

### ASYNCIFY to JSPI Migration

**Current State**: Using `ASYNCIFY=1` for async operations

**JSPI Benefits**:
- Smaller WASM output (no code transformation)
- Better performance (native VM support)
- Future-proof (ASYNCIFY may be deprecated)

**JSPI Requirements**:
- Browser support: Chrome 119+, Firefox (in progress)
- Replace `ASYNCIFY_EXPORTS` with `JSPI_EXPORTS`
- May require code changes in JavaScript integration layer

**Migration Strategy**:
Since we're optimizing for the future only, JSPI is the target async mode.

### JSPI Build Commands

```bash
# Build web target with JSPI
make jspi-web-mjs PHP_VERSION=8.4

# Build worker target with JSPI
make jspi-worker-mjs PHP_VERSION=8.4

# Build Node.js target with JSPI
make jspi-node-mjs PHP_VERSION=8.4

# Build all mjs targets with JSPI
make jspi-all PHP_VERSION=8.4

# Compare binary sizes between Asyncify and JSPI
make compare-async-modes PHP_VERSION=8.4
```

### Manual JSPI Configuration

You can also enable JSPI directly:

```bash
# Build any target with JSPI by setting ASYNCIFY=2
make web-mjs ASYNCIFY=2 PHP_VERSION=8.4

# Specify custom JSPI exports if needed
make web-mjs ASYNCIFY=2 JSPI_EXPORTS="['_main','_run_php']" PHP_VERSION=8.4
```

### JavaScript Integration

Both ASYNCIFY and JSPI work with the same JavaScript API:

```javascript
// This works with both ASYNCIFY=1 (legacy) and ASYNCIFY=2 (JSPI)
const result = await Module.ccall('functionName', 'number', ['string'], ['arg'], {async: true});
```

The key difference is that JSPI uses native JavaScript Promise integration
at the VM level, while ASYNCIFY transforms the WASM code to support unwinding/rewinding

### Deprecated Flags to Address

| Deprecated | Replacement | Notes |
|------------|-------------|-------|
| `ASYNCIFY_LAZY_LOAD_CODE` | Remove | Not compatible with JSPI |
| `ASYNCIFY_EXPORTS` | `JSPI_EXPORTS` | Only when using JSPI |
| `-s` prefix | Remove `-s` | Modern emcc accepts flags directly |

### Breaking Changes in Emscripten 3.1.x+

1. **Wasm Export Trampolines Removed**: Cannot store `Module['_malloc']` before instantiation
2. **Embind Exports Changed**: Must explicitly list runtime methods
3. **Pthread Worker File Removed**: `.worker.js` no longer generated

## Extension Compilation (SIDE_MODULE)

Extensions use the following pattern:

```makefile
emcc -shared -o extension.so -fPIC -sSIDE_MODULE=1 -O${OPTIMIZE} \
  -Wl,--whole-archive source.a dependencies.so
```

**Key flags for extensions**:
- `-sSIDE_MODULE=1` - Compile as side module
- `-fPIC` - Position independent code
- `-flto` - Link-time optimization
- `-Wl,--whole-archive` - Include all symbols

## Testing Matrix

| PHP Version | Lib Type | Node | Deno | Browser | Status |
|-------------|----------|------|------|---------|--------|
| 8.4 | static | TBD | TBD | TBD | - |
| 8.4 | shared | TBD | TBD | TBD | - |
| 8.4 | dynamic | TBD | TBD | TBD | - |
| 8.3 | static | TBD | TBD | TBD | - |
| 8.3 | shared | TBD | TBD | TBD | - |
| 8.3 | dynamic | TBD | TBD | TBD | - |
| 8.2 | static | TBD | TBD | TBD | - |
| 8.2 | shared | TBD | TBD | TBD | - |
| 8.2 | dynamic | TBD | TBD | TBD | - |
| 8.1 | static | TBD | TBD | TBD | - |
| 8.1 | shared | TBD | TBD | TBD | - |
| 8.1 | dynamic | TBD | TBD | TBD | - |
| 8.0 | static | TBD | TBD | TBD | - |
| 8.0 | shared | TBD | TBD | TBD | - |
| 8.0 | dynamic | TBD | TBD | TBD | - |

## Verification Commands

```bash
# Run Node.js tests
make test-node PHP_VERSION=8.4

# Run Deno tests (8.2+)
make test-deno PHP_VERSION=8.4

# Run browser tests
make test-browser PHP_VERSION=8.4

# WASM compatibility verification
make verify PHP_VERSION=8.4

# Verify all PHP versions
make verify-all

# Check for deprecated Emscripten flags
make check-deprecated

# Show current Emscripten version
make show-emscripten-version

# Validate WASM binary (requires wabt)
wasm-validate packages/php-wasm/php8.4-web.mjs.wasm
```

### WASM-Specific Test Files

The following test files verify WASM-specific behavior:

| File | Purpose |
|------|---------|
| `test/wasm-features.mjs` | Memory growth, async operations, module instantiation, error handling |
| `test/dynamic-libs.mjs` | SIDE_MODULE loading, extension discovery, isolation tests |
| `test/benchmarks.mjs` | Performance baselines, binary size tracking, memory usage |

Run these tests directly:

```bash
# WASM features tests
node --test test/wasm-features.mjs

# Dynamic library tests (requires dynamic build)
LIB_TYPE=dynamic node --test test/dynamic-libs.mjs

# Benchmark tests
node --test test/benchmarks.mjs
```

## Future WASM Features to Consider

### Memory64
- Allows >4GB address space
- Requires: `-sMEMORY64=1`
- Breaking: Changes pointer size

### Exception Handling
- Native WASM exceptions
- Requires: `-fwasm-exceptions`
- Better performance than JS-based exceptions

### Multi-Memory
- Multiple memory instances
- Useful for isolating extensions

### Threads (SharedArrayBuffer)
- Already partially supported via `-pthread`
- Requires secure context (HTTPS + COOP/COEP headers)

## Sources

- [Emscripten Settings Reference](https://emscripten.org/docs/tools_reference/settings_reference.html)
- [Emscripten Changelog](https://github.com/emscripten-core/emscripten/blob/main/ChangeLog.md)
- [ASYNCIFY Documentation](https://emscripten.org/docs/porting/asyncify.html)
- [Emscripten Release Notes](https://emscripten.org/docs/introducing_emscripten/release_notes.html)
