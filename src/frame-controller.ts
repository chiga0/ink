import instances from './instances.js';

export type ScreenSelection = {
	sx: number;
	sy: number;
	ex: number;
	ey: number;
};

export type FrameCell = {
	type: 'char';
	value: string;
	fullWidth: boolean;
	styles: unknown[];
	selectable: boolean;
	flowId: number | null;
};

export type FrameBoundary = {
	kind: 'soft' | 'hard';
	joiner: string;
	selectable: boolean;
	flowId: number;
};

export type ReadonlyFrame = {
	width: number;
	height: number;
	cells: ReadonlyArray<ReadonlyArray<FrameCell>>;
	boundaries: ReadonlyArray<ReadonlyArray<FrameBoundary | null>>;
};

export type FrameController = {
	getFrame(): ReadonlyFrame | null;
	getSelection(): ScreenSelection | null;
	setSelection(selection: ScreenSelection | null): void;
	subscribe(listener: (frame: ReadonlyFrame) => void): () => void;
	publishFrame(frame: ReadonlyFrame): void;
};

const sameSelection = (
	a: ScreenSelection | null,
	b: ScreenSelection | null,
): boolean => {
	if (a === b) {
		return true;
	}

	if (!a || !b) {
		return false;
	}

	return a.sx === b.sx && a.sy === b.sy && a.ex === b.ex && a.ey === b.ey;
};

// Creates the bidirectional bridge between the application and the renderer:
// the app reads the latest composited frame (getFrame) and pushes a selection
// (setSelection) that the renderer highlights before serialization. setSelection
// deduplicates and schedules exactly one repaint through Ink's own throttle via
// the requestRender callback, so it never mutates already-committed frame state.
export const createFrameController = (
	requestRender: () => void,
): FrameController => {
	let currentSelection: ScreenSelection | null = null;
	let lastFrame: ReadonlyFrame | null = null;
	const listeners = new Set<(frame: ReadonlyFrame) => void>();

	return {
		getFrame: () => lastFrame,
		getSelection: () => currentSelection,
		setSelection(selection: ScreenSelection | null) {
			if (sameSelection(currentSelection, selection)) {
				return;
			}

			currentSelection = selection;
			requestRender();
		},
		subscribe(listener: (frame: ReadonlyFrame) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		publishFrame(frame: ReadonlyFrame) {
			lastFrame = frame;
			for (const listener of listeners) {
				listener(frame);
			}
		},
	};
};

export const getFrameController = (
	stdout: NodeJS.WriteStream,
): FrameController | undefined => instances.get(stdout)?.frameController;
