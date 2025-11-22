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
1. Keep ASYNCIFY as default for broad compatibility
2. Add JSPI build variant for modern environments
3. Feature-detect at runtime when possible

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
