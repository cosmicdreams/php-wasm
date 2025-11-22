#!/bin/bash
# WASM 3.0 Compatibility Verification Script
# This script validates the build artifacts and runs compatibility checks

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PHP_VERSION="${PHP_VERSION:-8.4}"
LIB_TYPE="${LIB_TYPE:-dynamic}"
WASM_DIR="packages/php-wasm"

echo "================================================"
echo "WASM 3.0 Compatibility Verification"
echo "================================================"
echo "PHP Version: $PHP_VERSION"
echo "Library Type: $LIB_TYPE"
echo ""

# Track results
PASS=0
FAIL=0
WARN=0

pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASS++))
}

fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAIL++))
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    ((WARN++))
}

# 1. Check for WASM files
echo ""
echo "--- Checking WASM Artifacts ---"

WASM_FILES=(
    "${WASM_DIR}/php${PHP_VERSION}-web.mjs.wasm"
    "${WASM_DIR}/php${PHP_VERSION}-node.mjs.wasm"
    "${WASM_DIR}/php${PHP_VERSION}-worker.mjs.wasm"
)

for wasm_file in "${WASM_FILES[@]}"; do
    if [ -f "$wasm_file" ]; then
        size=$(stat -f%z "$wasm_file" 2>/dev/null || stat -c%s "$wasm_file" 2>/dev/null)
        pass "$wasm_file exists (${size} bytes)"
    else
        fail "$wasm_file not found"
    fi
done

# 2. Check for JavaScript modules
echo ""
echo "--- Checking JavaScript Modules ---"

JS_FILES=(
    "${WASM_DIR}/PhpBase.mjs"
    "${WASM_DIR}/PhpWeb.mjs"
    "${WASM_DIR}/PhpNode.mjs"
    "${WASM_DIR}/PhpWorker.mjs"
    "${WASM_DIR}/php${PHP_VERSION}-web.mjs"
    "${WASM_DIR}/php${PHP_VERSION}-node.mjs"
)

for js_file in "${JS_FILES[@]}"; do
    if [ -f "$js_file" ]; then
        pass "$js_file exists"
    else
        fail "$js_file not found"
    fi
done

# 3. Validate WASM binary structure (if wasm-tools available)
echo ""
echo "--- Validating WASM Binary Structure ---"

if command -v wasm-validate &> /dev/null; then
    for wasm_file in "${WASM_FILES[@]}"; do
        if [ -f "$wasm_file" ]; then
            if wasm-validate "$wasm_file" 2>/dev/null; then
                pass "WASM validation passed: $wasm_file"
            else
                fail "WASM validation failed: $wasm_file"
            fi
        fi
    done
else
    warn "wasm-validate not found - skipping binary validation"
    echo "    Install: npm install -g wabt"
fi

# 4. Check for deprecated Emscripten flags in source
echo ""
echo "--- Checking for Deprecated Flags ---"

DEPRECATED_FLAGS=(
    "ASYNCIFY_LAZY_LOAD_CODE"
    "USE_WEBGPU"
)

for flag in "${DEPRECATED_FLAGS[@]}"; do
    if grep -r "$flag" Makefile packages/*/static.mak 2>/dev/null | grep -v "^#" | grep -q "$flag"; then
        warn "Deprecated flag found: $flag"
    else
        pass "No deprecated flag: $flag"
    fi
done

# 5. Check dynamic library loading (if applicable)
echo ""
echo "--- Checking Dynamic Libraries ---"

if [ "$LIB_TYPE" = "dynamic" ] || [ "$LIB_TYPE" = "shared" ]; then
    SO_FILES=$(find packages -name "*.so" -type f 2>/dev/null | head -10)
    if [ -n "$SO_FILES" ]; then
        while IFS= read -r so_file; do
            pass "Shared library found: $so_file"
        done <<< "$SO_FILES"
    else
        warn "No .so files found for $LIB_TYPE build"
    fi
else
    pass "Static build - no shared libraries expected"
fi

# 6. Check Emscripten version in dockerfile
echo ""
echo "--- Checking Emscripten Configuration ---"

if [ -f "emscripten-builder.dockerfile" ]; then
    EMSDK_VER=$(grep "^ARG EMSDK_VERSION=" emscripten-builder.dockerfile | cut -d'"' -f2)
    if [ -n "$EMSDK_VER" ]; then
        pass "Emscripten version configured: $EMSDK_VER"

        # Check if version is known to work
        case "$EMSDK_VER" in
            3.1.43|3.1.44)
                pass "Using CloudFlare-compatible version"
                ;;
            3.1.67)
                warn "Using version with known CloudFlare issues"
                ;;
            *)
                warn "Using untested Emscripten version: $EMSDK_VER"
                ;;
        esac
    else
        fail "Could not determine Emscripten version"
    fi
else
    fail "emscripten-builder.dockerfile not found"
fi

# 7. Check critical Makefile flags
echo ""
echo "--- Checking Build Configuration ---"

REQUIRED_FLAGS=(
    "ASYNCIFY"
    "MAIN_MODULE"
    "MODULARIZE"
    "ALLOW_MEMORY_GROWTH"
    "FORCE_FILESYSTEM"
)

for flag in "${REQUIRED_FLAGS[@]}"; do
    if grep -q "$flag" Makefile 2>/dev/null; then
        pass "Required flag configured: $flag"
    else
        fail "Required flag missing: $flag"
    fi
done

# 8. Run basic Node.js test if possible
echo ""
echo "--- Running Basic Functionality Test ---"

if command -v node &> /dev/null && [ -f "${WASM_DIR}/PhpNode.mjs" ]; then
    TEST_RESULT=$(node --experimental-vm-modules -e "
        import('${WASM_DIR}/PhpNode.mjs')
            .then(m => console.log('Module loads: OK'))
            .catch(e => console.log('Module loads: FAIL - ' + e.message))
    " 2>&1 || echo "Module test failed")

    if echo "$TEST_RESULT" | grep -q "OK"; then
        pass "Node.js module loading works"
    else
        warn "Node.js module test: $TEST_RESULT"
    fi
else
    warn "Skipping Node.js test - node not available or modules not built"
fi

# Summary
echo ""
echo "================================================"
echo "Verification Summary"
echo "================================================"
echo -e "${GREEN}Passed:${NC} $PASS"
echo -e "${RED}Failed:${NC} $FAIL"
echo -e "${YELLOW}Warnings:${NC} $WARN"
echo ""

if [ $FAIL -gt 0 ]; then
    echo -e "${RED}Some checks failed. Please review the output above.${NC}"
    exit 1
elif [ $WARN -gt 0 ]; then
    echo -e "${YELLOW}All checks passed with warnings.${NC}"
    exit 0
else
    echo -e "${GREEN}All checks passed!${NC}"
    exit 0
fi
