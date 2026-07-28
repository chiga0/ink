import test from 'ava';
import React from 'react';
import {Box, Text, render, getFrameController} from '../src/index.js';
import createStdout from './helpers/create-stdout.js';

// The selection background applied to selected cells (see output.ts).
const selectionBackground = '[48;5;240m';

test('getFrameController returns undefined for an unknown stdout', t => {
	const stdout = createStdout();
	t.is(getFrameController(stdout), undefined);
});

test('getFrameController returns a controller after render', t => {
	const stdout = createStdout();
	const {unmount} = render(<Text>Hello</Text>, {stdout, debug: true});

	const controller = getFrameController(stdout);
	t.truthy(controller);

	unmount();
});

test('getFrame exposes the composited cells', t => {
	const stdout = createStdout();
	const {unmount} = render(<Text>Hi</Text>, {stdout, debug: true});

	const frame = getFrameController(stdout)!.getFrame();
	t.truthy(frame);
	t.is(frame!.height, 1);
	t.true(frame!.width >= 2);

	const row = frame!.cells[0]!;
	t.is(row[0]!.value, 'H');
	t.is(row[1]!.value, 'i');

	unmount();
});

test('text cells are selectable by default', t => {
	const stdout = createStdout();
	const {unmount} = render(<Text>Hi</Text>, {stdout, debug: true});

	const frame = getFrameController(stdout)!.getFrame();
	const row = frame!.cells[0]!;
	t.true(row[0]!.selectable);
	t.true(row[1]!.selectable);

	unmount();
});

test('selectable={false} marks cells as non-selectable', t => {
	const stdout = createStdout();
	const {unmount} = render(<Text selectable={false}>Hi</Text>, {
		stdout,
		debug: true,
	});

	const frame = getFrameController(stdout)!.getFrame();
	const row = frame!.cells[0]!;
	t.false(row[0]!.selectable);
	t.false(row[1]!.selectable);

	unmount();
});

test('setSelection highlights the selected cells', t => {
	const stdout = createStdout();
	const {unmount} = render(<Text>Hello</Text>, {stdout, debug: true});

	t.false(
		stdout.get().includes(selectionBackground),
		'no highlight before selection',
	);

	getFrameController(stdout)!.setSelection({sx: 0, sy: 0, ex: 4, ey: 0});

	t.true(
		stdout.get().includes(selectionBackground),
		'selected region is highlighted after setSelection',
	);

	unmount();
});

test('clearing the selection removes the highlight', t => {
	const stdout = createStdout();
	const {unmount} = render(<Text>Hello</Text>, {stdout, debug: true});

	const controller = getFrameController(stdout)!;
	controller.setSelection({sx: 0, sy: 0, ex: 4, ey: 0});
	t.true(stdout.get().includes(selectionBackground));

	controller.setSelection(undefined);
	t.false(
		stdout.get().includes(selectionBackground),
		'highlight is gone after clearing the selection',
	);

	unmount();
});

test('setting an identical selection does not trigger a repaint', t => {
	const stdout = createStdout();
	const {unmount} = render(<Text>Hello</Text>, {stdout, debug: true});

	const controller = getFrameController(stdout)!;
	controller.setSelection({sx: 0, sy: 0, ex: 4, ey: 0});

	const writeCountAfterFirst = (stdout.write as any).callCount as number;

	// Same coordinates → deduplicated, no additional write.
	controller.setSelection({sx: 0, sy: 0, ex: 4, ey: 0});

	t.is((stdout.write as any).callCount, writeCountAfterFirst);

	unmount();
});

test('subscribe receives the composited frame', t => {
	const stdout = createStdout();
	const {unmount} = render(<Text>Hello</Text>, {stdout, debug: true});

	const controller = getFrameController(stdout)!;
	let received: number | undefined;

	const unsubscribe = controller.subscribe(frame => {
		received = frame.height;
	});

	// A selection change schedules a repaint, which publishes a new frame.
	controller.setSelection({sx: 0, sy: 0, ex: 1, ey: 0});

	t.is(received, 1);

	unsubscribe();
	unmount();
});

test('text nodes sharing a selectionFlow share a flowId', t => {
	const stdout = createStdout();
	const {unmount} = render(
		<Box>
			<Text selectionFlow="group">A</Text>
			<Text selectionFlow="group">B</Text>
		</Box>,
		{stdout, debug: true},
	);

	const row = getFrameController(stdout)!.getFrame()!.cells[0]!;
	const aCell = row.find(cell => cell.value === 'A')!;
	const bCell = row.find(cell => cell.value === 'B')!;

	t.is(typeof aCell.flowId, 'number');
	t.is(aCell.flowId, bCell.flowId);

	unmount();
});

test('text nodes without a shared selectionFlow get distinct flowIds', t => {
	const stdout = createStdout();
	const {unmount} = render(
		<Box>
			<Text>A</Text>
			<Text>B</Text>
		</Box>,
		{stdout, debug: true},
	);

	const row = getFrameController(stdout)!.getFrame()!.cells[0]!;
	const aCell = row.find(cell => cell.value === 'A')!;
	const bCell = row.find(cell => cell.value === 'B')!;

	t.not(aCell.flowId, bCell.flowId);

	unmount();
});

test('selectionBreakAfter="hard" records a hard boundary', t => {
	const stdout = createStdout();
	const {unmount} = render(
		<Box>
			<Text selectionBreakAfter="hard">A</Text>
		</Box>,
		{stdout, debug: true},
	);

	const {boundaries} = getFrameController(stdout)!.getFrame()!;
	const hasHardBoundary = boundaries.some(row =>
		row.some(boundary => boundary?.kind === 'hard'),
	);

	t.true(hasHardBoundary);

	unmount();
});
