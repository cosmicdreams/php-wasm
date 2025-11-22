/**
 * WASM-Specific Feature Tests
 *
 * These tests verify WebAssembly-specific behavior that is critical for
 * ASYNCIFY/JSPI migration and Emscripten upgrades.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PhpNode } from '../packages/php-wasm/PhpNode.mjs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const phpVersion = process.env.PHP_VERSION ?? '8.4';
const phpVariant = process.env.PHP_VARIANT ?? '';

// ============================================================================
// Memory Growth Tests
// ============================================================================

test('WASM memory can grow dynamically', async () => {
	const php = new PhpNode();

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	// Allocate a large string (10MB) to trigger memory growth
	const exitCode = await php.run(`<?php
		$size = 10 * 1024 * 1024; // 10MB
		$largeString = str_repeat('x', $size);
		echo strlen($largeString);
	`);

	assert.equal(exitCode, 0, 'Exit code should be 0');
	assert.equal(stdOut.trim(), '10485760', 'Should allocate 10MB string');
	assert.equal(stdErr, '', 'No errors expected');
});

test('WASM memory handles multiple growth cycles', async () => {
	const php = new PhpNode();

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	// Allocate progressively larger chunks
	const exitCode = await php.run(`<?php
		$sizes = [1, 5, 10, 20]; // MB
		$results = [];
		foreach ($sizes as $mb) {
			$str = str_repeat('y', $mb * 1024 * 1024);
			$results[] = strlen($str);
			unset($str);
		}
		echo json_encode($results);
	`);

	assert.equal(exitCode, 0, 'Exit code should be 0');
	const results = JSON.parse(stdOut.trim());
	assert.deepEqual(results, [1048576, 5242880, 10485760, 20971520], 'All allocations should succeed');
	assert.equal(stdErr, '', 'No errors expected');
});

// ============================================================================
// Async Operation Tests (ASYNCIFY/JSPI critical)
// ============================================================================

test('Async PHP execution completes correctly', async () => {
	const php = new PhpNode();

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	// Multiple sequential async calls
	const results = [];
	for (let i = 0; i < 5; i++) {
		const exitCode = await php.run(`<?php echo ${i};`);
		results.push({ exitCode, output: stdOut });
		stdOut = '';
	}

	assert.equal(results.length, 5, 'All 5 calls should complete');
	results.forEach((r, i) => {
		assert.equal(r.exitCode, 0, `Call ${i} should succeed`);
	});
});

test('Async operations maintain state correctly', async () => {
	const php = new PhpNode();

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	// Set a variable
	await php.run(`<?php $counter = 0;`);

	// Increment it multiple times
	for (let i = 0; i < 10; i++) {
		await php.run(`<?php $counter++;`);
	}

	// Read the final value
	stdOut = '';
	await php.run(`<?php echo $counter;`);

	assert.equal(stdOut.trim(), '10', 'Counter should be 10 after 10 increments');
});

test('Long-running PHP operations complete without timeout', async () => {
	const php = new PhpNode();

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	const startTime = Date.now();

	// Run a computation that takes some time
	const exitCode = await php.run(`<?php
		$sum = 0;
		for ($i = 0; $i < 1000000; $i++) {
			$sum += $i;
		}
		echo $sum;
	`);

	const elapsed = Date.now() - startTime;

	assert.equal(exitCode, 0, 'Exit code should be 0');
	assert.equal(stdOut.trim(), '499999500000', 'Sum should be correct');
	assert.ok(elapsed < 30000, 'Should complete within 30 seconds');
});

// ============================================================================
// Module Instantiation Tests
// ============================================================================

test('PHP module loads without errors', async () => {
	let loadError = null;

	try {
		const php = new PhpNode();
		await php.binary;
	} catch (e) {
		loadError = e;
	}

	assert.equal(loadError, null, 'Module should load without errors');
});

test('Multiple PHP instances can be created', async () => {
	const instances = [];

	for (let i = 0; i < 3; i++) {
		const php = new PhpNode();
		await php.binary;
		instances.push(php);
	}

	// Each instance should work independently
	for (let i = 0; i < instances.length; i++) {
		let stdOut = '';
		instances[i].addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
		await instances[i].run(`<?php echo "instance-${i}";`);
		assert.ok(stdOut.includes(`instance-${i}`), `Instance ${i} should output correctly`);
	}

	assert.equal(instances.length, 3, 'All 3 instances should be created');
});

test('PHP instance can be refreshed and reused', async () => {
	const php = new PhpNode();

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	// Set a variable
	await php.run(`<?php $test = "before";`);

	// Refresh
	await php.refresh();

	// Variable should be undefined now
	stdOut = '';
	await php.run(`<?php echo isset($test) ? "set" : "unset";`);

	assert.equal(stdOut.trim(), 'unset', 'Variable should be unset after refresh');
});

// ============================================================================
// WASM Binary Validation Tests
// ============================================================================

test('WASM binary exists and has valid magic bytes', async () => {
	const wasmPath = join(process.cwd(), `packages/php-wasm/php${phpVersion}${phpVariant}-node.mjs.wasm`);

	let wasmBuffer;
	try {
		wasmBuffer = await readFile(wasmPath);
	} catch (e) {
		// Skip if file doesn't exist (not built yet)
		if (e.code === 'ENOENT') {
			return;
		}
		throw e;
	}

	// WASM magic bytes: 0x00 0x61 0x73 0x6D ('\0asm')
	const magic = wasmBuffer.slice(0, 4);
	assert.equal(magic[0], 0x00, 'First magic byte should be 0x00');
	assert.equal(magic[1], 0x61, 'Second magic byte should be 0x61 (a)');
	assert.equal(magic[2], 0x73, 'Third magic byte should be 0x73 (s)');
	assert.equal(magic[3], 0x6D, 'Fourth magic byte should be 0x6D (m)');

	// WASM version (should be 1)
	const version = wasmBuffer.slice(4, 8);
	assert.equal(version[0], 0x01, 'WASM version should be 1');
});

test('WASM binary is within expected size range', async () => {
	const wasmPath = join(process.cwd(), `packages/php-wasm/php${phpVersion}${phpVariant}-node.mjs.wasm`);

	let stats;
	try {
		stats = await stat(wasmPath);
	} catch (e) {
		// Skip if file doesn't exist (not built yet)
		if (e.code === 'ENOENT') {
			return;
		}
		throw e;
	}

	const sizeInMB = stats.size / (1024 * 1024);

	// Expect WASM to be between 5MB and 100MB (reasonable range for PHP)
	assert.ok(sizeInMB >= 5, `WASM should be at least 5MB (got ${sizeInMB.toFixed(2)}MB)`);
	assert.ok(sizeInMB <= 100, `WASM should be at most 100MB (got ${sizeInMB.toFixed(2)}MB)`);

	// Log actual size for baseline tracking
	console.log(`    WASM binary size: ${sizeInMB.toFixed(2)}MB`);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test('PHP syntax errors are handled gracefully', async () => {
	const php = new PhpNode();

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	// Run code with syntax error
	const exitCode = await php.run(`<?php
		echo "before";
		this is not valid PHP
		echo "after";
	`);

	// Should not crash, but should indicate error
	assert.ok(exitCode !== 0 || stdErr.length > 0 || stdOut.includes('Parse error'),
		'Syntax error should be reported');
});

test('PHP runtime errors are handled gracefully', async () => {
	const php = new PhpNode();

	let stdOut = '', stdErr = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));
	php.addEventListener('error', (event) => event.detail.forEach(line => void (stdErr += line)));

	await php.binary;

	// Call undefined function
	await php.run(`<?php
		ini_set('display_errors', 1);
		error_reporting(E_ALL);
		undefined_function_xyz();
	`);

	// Should report error but not crash
	assert.ok(stdErr.length > 0 || stdOut.includes('undefined_function'),
		'Runtime error should be reported');
});
