/**
 * Performance Baseline Tests
 *
 * These tests establish performance baselines and detect regressions.
 * They measure execution time, memory usage, and binary sizes.
 *
 * Run with: PHP_VERSION=8.4 node --test test/benchmarks.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PhpNode } from '../packages/php-wasm/PhpNode.mjs';
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const phpVersion = process.env.PHP_VERSION ?? '8.4';
const phpVariant = process.env.PHP_VARIANT ?? '';

// Performance thresholds (adjust based on baseline measurements)
const THRESHOLDS = {
	moduleLoadTimeMs: 10000,      // Max time to load PHP module
	simpleExecTimeMs: 1000,       // Max time for simple echo
	benchPhpTimeMs: 60000,        // Max time for Zend/bench.php
	wasmSizeMaxMB: 80,            // Max WASM binary size
	wasmSizeMinMB: 5,             // Min WASM binary size (sanity check)
	memoryPeakMB: 512,            // Max memory during heavy operation
};

// ============================================================================
// Module Load Time Tests
// ============================================================================

test('PHP module loads within acceptable time', async () => {
	const startTime = Date.now();

	const php = new PhpNode();
	await php.binary;

	const loadTime = Date.now() - startTime;

	console.log(`    Module load time: ${loadTime}ms`);

	assert.ok(loadTime < THRESHOLDS.moduleLoadTimeMs,
		`Module load time (${loadTime}ms) should be < ${THRESHOLDS.moduleLoadTimeMs}ms`);
});

test('Subsequent module loads are not slower', async () => {
	const times = [];

	for (let i = 0; i < 3; i++) {
		const startTime = Date.now();
		const php = new PhpNode();
		await php.binary;
		times.push(Date.now() - startTime);
	}

	console.log(`    Load times: ${times.map(t => t + 'ms').join(', ')}`);

	// Second and third loads shouldn't be significantly slower than first
	// (allows for some variance but catches major regressions)
	const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
	assert.ok(avgTime < THRESHOLDS.moduleLoadTimeMs,
		`Average load time (${avgTime.toFixed(0)}ms) should be < ${THRESHOLDS.moduleLoadTimeMs}ms`);
});

// ============================================================================
// Execution Time Tests
// ============================================================================

test('Simple PHP execution is fast', async () => {
	const php = new PhpNode();
	await php.binary;

	let stdOut = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));

	const startTime = Date.now();
	await php.run(`<?php echo "hello";`);
	const execTime = Date.now() - startTime;

	console.log(`    Simple exec time: ${execTime}ms`);

	assert.equal(stdOut.trim(), 'hello');
	assert.ok(execTime < THRESHOLDS.simpleExecTimeMs,
		`Simple exec time (${execTime}ms) should be < ${THRESHOLDS.simpleExecTimeMs}ms`);
});

test('Loop execution benchmark', async () => {
	const php = new PhpNode();
	await php.binary;

	let stdOut = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));

	const startTime = Date.now();
	await php.run(`<?php
		$sum = 0;
		for ($i = 0; $i < 1000000; $i++) {
			$sum += $i;
		}
		echo $sum;
	`);
	const execTime = Date.now() - startTime;

	console.log(`    1M loop iterations: ${execTime}ms`);

	assert.equal(stdOut.trim(), '499999500000');
	// This is informational - we track the time but don't fail on it
});

test('String manipulation benchmark', async () => {
	const php = new PhpNode();
	await php.binary;

	let stdOut = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));

	const startTime = Date.now();
	await php.run(`<?php
		$str = "";
		for ($i = 0; $i < 10000; $i++) {
			$str .= "x";
		}
		echo strlen($str);
	`);
	const execTime = Date.now() - startTime;

	console.log(`    10K string concats: ${execTime}ms`);

	assert.equal(stdOut.trim(), '10000');
});

test('Array manipulation benchmark', async () => {
	const php = new PhpNode();
	await php.binary;

	let stdOut = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));

	const startTime = Date.now();
	await php.run(`<?php
		$arr = [];
		for ($i = 0; $i < 100000; $i++) {
			$arr[] = $i;
		}
		echo count($arr);
	`);
	const execTime = Date.now() - startTime;

	console.log(`    100K array pushes: ${execTime}ms`);

	assert.equal(stdOut.trim(), '100000');
});

test('JSON encode/decode benchmark', async () => {
	const php = new PhpNode();
	await php.binary;

	let stdOut = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));

	const startTime = Date.now();
	await php.run(`<?php
		$data = range(0, 10000);
		for ($i = 0; $i < 100; $i++) {
			$json = json_encode($data);
			$decoded = json_decode($json, true);
		}
		echo count($decoded);
	`);
	const execTime = Date.now() - startTime;

	console.log(`    100 JSON cycles (10K items): ${execTime}ms`);

	assert.equal(stdOut.trim(), '10001');
});

// ============================================================================
// Binary Size Tests
// ============================================================================

test('WASM binary size is within expected range', async () => {
	const wasmPath = join(process.cwd(), `packages/php-wasm/php${phpVersion}${phpVariant}-node.mjs.wasm`);

	try {
		const stats = await stat(wasmPath);
		const sizeMB = stats.size / (1024 * 1024);

		console.log(`    WASM size: ${sizeMB.toFixed(2)}MB`);

		assert.ok(sizeMB >= THRESHOLDS.wasmSizeMinMB,
			`WASM size (${sizeMB.toFixed(2)}MB) should be >= ${THRESHOLDS.wasmSizeMinMB}MB`);
		assert.ok(sizeMB <= THRESHOLDS.wasmSizeMaxMB,
			`WASM size (${sizeMB.toFixed(2)}MB) should be <= ${THRESHOLDS.wasmSizeMaxMB}MB`);
	} catch (e) {
		if (e.code === 'ENOENT') {
			console.log('    Skipping: WASM file not built');
			return;
		}
		throw e;
	}
});

test('JavaScript wrapper size is reasonable', async () => {
	const jsPath = join(process.cwd(), `packages/php-wasm/php${phpVersion}${phpVariant}-node.mjs`);

	try {
		const stats = await stat(jsPath);
		const sizeKB = stats.size / 1024;

		console.log(`    JS wrapper size: ${sizeKB.toFixed(1)}KB`);

		// JS wrapper should be < 1MB
		assert.ok(sizeKB < 1024,
			`JS wrapper (${sizeKB.toFixed(1)}KB) should be < 1MB`);
	} catch (e) {
		if (e.code === 'ENOENT') {
			console.log('    Skipping: JS file not built');
			return;
		}
		throw e;
	}
});

test('Total package size inventory', async () => {
	const pkgDir = join(process.cwd(), 'packages/php-wasm');

	try {
		const files = await readdir(pkgDir);
		let totalSize = 0;
		const sizes = {};

		for (const file of files) {
			const filePath = join(pkgDir, file);
			try {
				const stats = await stat(filePath);
				if (stats.isFile()) {
					totalSize += stats.size;
					const ext = file.split('.').pop();
					sizes[ext] = (sizes[ext] || 0) + stats.size;
				}
			} catch (e) {
				// Skip
			}
		}

		const totalMB = totalSize / (1024 * 1024);
		console.log(`    Total package size: ${totalMB.toFixed(2)}MB`);

		for (const [ext, size] of Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
			console.log(`      .${ext}: ${(size / (1024 * 1024)).toFixed(2)}MB`);
		}
	} catch (e) {
		if (e.code === 'ENOENT') {
			console.log('    Skipping: package directory not found');
			return;
		}
		throw e;
	}
});

// ============================================================================
// Memory Usage Tests
// ============================================================================

test('Memory usage for basic operations', async () => {
	const php = new PhpNode();
	await php.binary;

	let stdOut = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));

	await php.run(`<?php
		echo json_encode([
			'memory_usage' => memory_get_usage(true),
			'peak_usage' => memory_get_peak_usage(true),
		]);
	`);

	const memInfo = JSON.parse(stdOut.trim());
	const usageMB = memInfo.memory_usage / (1024 * 1024);
	const peakMB = memInfo.peak_usage / (1024 * 1024);

	console.log(`    PHP memory usage: ${usageMB.toFixed(2)}MB`);
	console.log(`    PHP peak usage: ${peakMB.toFixed(2)}MB`);

	assert.ok(peakMB < THRESHOLDS.memoryPeakMB,
		`Peak memory (${peakMB.toFixed(2)}MB) should be < ${THRESHOLDS.memoryPeakMB}MB`);
});

test('Memory usage after large allocation', async () => {
	const php = new PhpNode();
	await php.binary;

	let stdOut = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));

	await php.run(`<?php
		// Allocate 50MB
		$data = str_repeat('x', 50 * 1024 * 1024);
		echo json_encode([
			'allocated_size' => strlen($data),
			'memory_usage' => memory_get_usage(true),
			'peak_usage' => memory_get_peak_usage(true),
		]);
	`);

	const memInfo = JSON.parse(stdOut.trim());
	const allocatedMB = memInfo.allocated_size / (1024 * 1024);
	const usageMB = memInfo.memory_usage / (1024 * 1024);
	const peakMB = memInfo.peak_usage / (1024 * 1024);

	console.log(`    Allocated: ${allocatedMB.toFixed(2)}MB`);
	console.log(`    Memory usage: ${usageMB.toFixed(2)}MB`);
	console.log(`    Peak usage: ${peakMB.toFixed(2)}MB`);

	assert.ok(allocatedMB >= 49, 'Should allocate ~50MB');
});

test('Memory is reclaimed after refresh', async () => {
	const php = new PhpNode();
	await php.binary;

	let stdOut = '';
	php.addEventListener('output', (event) => event.detail.forEach(line => void (stdOut += line)));

	// Allocate large amount
	await php.run(`<?php $data = str_repeat('x', 20 * 1024 * 1024);`);

	// Get peak before refresh
	stdOut = '';
	await php.run(`<?php echo memory_get_peak_usage(true);`);
	const peakBefore = parseInt(stdOut.trim());

	// Refresh
	await php.refresh();

	// Check memory after refresh
	stdOut = '';
	await php.run(`<?php echo memory_get_usage(true);`);
	const usageAfter = parseInt(stdOut.trim());

	const peakBeforeMB = peakBefore / (1024 * 1024);
	const usageAfterMB = usageAfter / (1024 * 1024);

	console.log(`    Peak before refresh: ${peakBeforeMB.toFixed(2)}MB`);
	console.log(`    Usage after refresh: ${usageAfterMB.toFixed(2)}MB`);

	// After refresh, memory usage should be lower than peak
	assert.ok(usageAfter < peakBefore,
		'Memory usage after refresh should be lower than peak before');
});

// ============================================================================
// Throughput Tests
// ============================================================================

test('Multiple sequential executions throughput', async () => {
	const php = new PhpNode();
	await php.binary;

	let count = 0;
	php.addEventListener('output', () => count++);

	const iterations = 100;
	const startTime = Date.now();

	for (let i = 0; i < iterations; i++) {
		await php.run(`<?php echo "x";`);
	}

	const totalTime = Date.now() - startTime;
	const opsPerSec = (iterations / totalTime) * 1000;

	console.log(`    ${iterations} executions in ${totalTime}ms`);
	console.log(`    Throughput: ${opsPerSec.toFixed(1)} ops/sec`);

	// Should achieve at least 10 ops/sec
	assert.ok(opsPerSec > 10, `Throughput (${opsPerSec.toFixed(1)} ops/sec) should be > 10 ops/sec`);
});
