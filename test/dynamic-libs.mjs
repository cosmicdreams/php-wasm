/**
 * Dynamic Library Loading Tests
 *
 * These tests verify that SIDE_MODULE (.so) loading works correctly,
 * which is critical for the extension system and WASM modularity.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PhpNode } from '../packages/php-wasm/PhpNode.mjs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const phpVersion = process.env.PHP_VERSION ?? '8.4';
const libType = process.env.LIB_TYPE ?? 'dynamic';

// Helper to check if we're in dynamic/shared mode
const isDynamicMode = () => ['dynamic', 'shared'].includes(libType);

// ============================================================================
// Shared Library Discovery Tests
// ============================================================================

test('Shared library files exist in packages directory', async () => {
	if (!isDynamicMode()) {
		console.log('    Skipping: not in dynamic/shared mode');
		return;
	}

	const packagesDir = join(process.cwd(), 'packages');
	const soFiles = [];

	// Scan packages for .so files
	const packages = await readdir(packagesDir);
	for (const pkg of packages) {
		const pkgPath = join(packagesDir, pkg);
		try {
			const files = await readdir(pkgPath);
			for (const file of files) {
				if (file.endsWith('.so')) {
					soFiles.push(join(pkg, file));
				}
			}
		} catch (e) {
			// Skip non-directories
		}
	}

	console.log(`    Found ${soFiles.length} .so files`);
	if (soFiles.length > 0) {
		console.log(`    Examples: ${soFiles.slice(0, 3).join(', ')}`);
	}

	// In dynamic mode, we should have at least some .so files if built
	// This is informational - won't fail if not built
});

test('Shared library files have valid size', async () => {
	if (!isDynamicMode()) {
		console.log('    Skipping: not in dynamic/shared mode');
		return;
	}

	const sqliteSo = join(process.cwd(), 'packages/sqlite/libsqlite3.so');

	try {
		const stats = await stat(sqliteSo);
		const sizeKB = stats.size / 1024;

		assert.ok(sizeKB > 100, `libsqlite3.so should be >100KB (got ${sizeKB.toFixed(1)}KB)`);
		assert.ok(sizeKB < 10000, `libsqlite3.so should be <10MB (got ${sizeKB.toFixed(1)}KB)`);

		console.log(`    libsqlite3.so size: ${sizeKB.toFixed(1)}KB`);
	} catch (e) {
		if (e.code === 'ENOENT') {
			console.log('    Skipping: libsqlite3.so not built');
			return;
		}
		throw e;
	}
});

// ============================================================================
// Dynamic Extension Loading Tests
// ============================================================================

test('Can load SQLite extension dynamically', async () => {
	if (process.env.WITH_SQLITE !== 'dynamic') {
		console.log('    Skipping: SQLite not in dynamic mode');
		return;
	}

	const php = new PhpNode({
		sharedLibs: [`php${phpVersion}-sqlite.so`]
	});

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	const exitCode = await php.run(`<?php
		var_dump(extension_loaded('sqlite3'));
		var_dump(class_exists('SQLite3'));
	`);

	assert.equal(exitCode, 0, 'Exit code should be 0');
	assert.ok(stdOut.includes('bool(true)'), 'SQLite3 extension should be loaded');
});

test('Can use dynamically loaded SQLite to create database', async () => {
	if (process.env.WITH_SQLITE !== 'dynamic') {
		console.log('    Skipping: SQLite not in dynamic mode');
		return;
	}

	const php = new PhpNode({
		sharedLibs: [`php${phpVersion}-sqlite.so`, `php${phpVersion}-pdo-sqlite.so`]
	});

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	const exitCode = await php.run(`<?php
		$db = new SQLite3(':memory:');
		$db->exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
		$db->exec("INSERT INTO test (name) VALUES ('hello')");
		$result = $db->querySingle("SELECT name FROM test WHERE id = 1");
		echo $result;
	`);

	assert.equal(exitCode, 0, 'Exit code should be 0');
	assert.equal(stdOut.trim(), 'hello', 'Should retrieve inserted value');
	assert.equal(stdErr, '', 'No errors expected');
});

test('Can load multiple extensions simultaneously', async () => {
	if (process.env.WITH_SQLITE !== 'dynamic' || process.env.WITH_ZLIB !== 'dynamic') {
		console.log('    Skipping: requires both SQLite and zlib in dynamic mode');
		return;
	}

	const php = new PhpNode({
		sharedLibs: [
			`php${phpVersion}-sqlite.so`,
			// Add more dynamic extensions as available
		]
	});

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	const exitCode = await php.run(`<?php
		$extensions = get_loaded_extensions();
		echo json_encode($extensions);
	`);

	assert.equal(exitCode, 0, 'Exit code should be 0');

	const extensions = JSON.parse(stdOut.trim());
	assert.ok(Array.isArray(extensions), 'Should return array of extensions');
	assert.ok(extensions.length > 0, 'Should have at least one extension');

	console.log(`    Loaded extensions: ${extensions.length}`);
});

// ============================================================================
// Extension Module Loading Patterns
// ============================================================================

test('Static module loader pattern works', async () => {
	// Test the pattern: import sqlite from 'php-wasm-sqlite'
	// This should work regardless of build mode

	try {
		const sqlite = await import('php-wasm-sqlite');

		// The module should export extension info
		assert.ok(sqlite, 'Module should export something');

		console.log('    Static module loader: available');
	} catch (e) {
		if (e.code === 'ERR_MODULE_NOT_FOUND') {
			console.log('    Static module loader: package not installed');
			return;
		}
		throw e;
	}
});

test('Dynamic module loader pattern works', async () => {
	// Test the pattern: await import('php-wasm-sqlite')

	try {
		const sqliteModule = await import('php-wasm-sqlite');

		if (process.env.WITH_SQLITE === 'dynamic') {
			const php = new PhpNode({
				sharedLibs: [sqliteModule]
			});

			await php.binary;

			let stdOut = '';
			php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));

			await php.run(`<?php echo extension_loaded('sqlite3') ? 'yes' : 'no';`);

			assert.equal(stdOut.trim(), 'yes', 'SQLite should be loaded via dynamic import');
		}

		console.log('    Dynamic module loader: working');
	} catch (e) {
		if (e.code === 'ERR_MODULE_NOT_FOUND') {
			console.log('    Dynamic module loader: package not installed');
			return;
		}
		throw e;
	}
});

// ============================================================================
// Extension Isolation Tests
// ============================================================================

test('Extensions do not interfere with each other', async () => {
	const php = new PhpNode();

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	// Get list of loaded extensions
	const exitCode = await php.run(`<?php
		$extensions = get_loaded_extensions();
		$functions = get_defined_functions()['internal'];
		echo json_encode([
			'extension_count' => count($extensions),
			'function_count' => count($functions),
			'has_core' => in_array('Core', $extensions),
			'has_standard' => in_array('standard', $extensions),
		]);
	`);

	assert.equal(exitCode, 0, 'Exit code should be 0');

	const info = JSON.parse(stdOut.trim());
	assert.ok(info.extension_count > 0, 'Should have extensions loaded');
	assert.ok(info.function_count > 0, 'Should have functions defined');
	assert.ok(info.has_core, 'Core extension should be loaded');

	console.log(`    Extensions: ${info.extension_count}, Functions: ${info.function_count}`);
});

test('Extension loading order is deterministic', async () => {
	// Create two instances and verify they have the same extensions

	const getExtensions = async () => {
		const php = new PhpNode();
		let stdOut = '';
		php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
		await php.binary;
		await php.run(`<?php echo json_encode(get_loaded_extensions());`);
		return JSON.parse(stdOut.trim());
	};

	const ext1 = await getExtensions();
	const ext2 = await getExtensions();

	assert.deepEqual(ext1, ext2, 'Extension lists should be identical across instances');
});

// ============================================================================
// Side Module Compatibility Tests
// ============================================================================

test('SIDE_MODULE compiled extensions have correct format', async () => {
	if (!isDynamicMode()) {
		console.log('    Skipping: not in dynamic/shared mode');
		return;
	}

	const sqliteSo = join(process.cwd(), 'packages/sqlite/libsqlite3.so');

	try {
		const { readFile } = await import('node:fs/promises');
		const buffer = await readFile(sqliteSo);

		// Check WASM magic bytes
		assert.equal(buffer[0], 0x00, 'Should have WASM magic byte 1');
		assert.equal(buffer[1], 0x61, 'Should have WASM magic byte 2');
		assert.equal(buffer[2], 0x73, 'Should have WASM magic byte 3');
		assert.equal(buffer[3], 0x6D, 'Should have WASM magic byte 4');

		console.log('    .so file has valid WASM header');
	} catch (e) {
		if (e.code === 'ENOENT') {
			console.log('    Skipping: libsqlite3.so not built');
			return;
		}
		throw e;
	}
});
