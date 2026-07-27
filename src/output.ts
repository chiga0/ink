import sliceAnsi from 'slice-ansi';
import stringWidth from 'string-width';
import {
	type StyledChar,
	styledCharsFromTokens,
	styledCharsToString,
	tokenize,
} from '@alcalzone/ansi-tokenize';
import {type OutputTransformer} from './render-node-to-output.js';
import {
	type ScreenSelection,
	type FrameCell,
	type FrameBoundary,
} from './frame-controller.js';
import {type TextBoundary} from './wrap-text.js';

// Background applied to selected cells. Appended after a cell's existing styles
// so the foreground is preserved and this background wins at the terminal.
const SELECTION_BG = {code: '\x1b[48;5;240m', endCode: '\x1b[49m'};

// Linear reading-order selection: whole rows between the first and last, partial
// on the first/last row. Coordinates are screen cells in the composited frame.
const isCellSelected = (
	x: number,
	y: number,
	sel: ScreenSelection,
): boolean => {
	if (y < sel.sy || y > sel.ey) {
		return false;
	}

	if (sel.sy === sel.ey) {
		return x >= sel.sx && x <= sel.ex;
	}

	if (y === sel.sy) {
		return x >= sel.sx;
	}

	if (y === sel.ey) {
		return x <= sel.ex;
	}

	return true;
};

export type SemanticMetadata = {
	flowId: number;
	selectable: boolean;
	selectableRows: boolean[];
	boundaries: (TextBoundary | null)[];
};

/**
"Virtual" output class

Handles the positioning and saving of the output of each node in the tree. Also responsible for applying transformations to each character of the output.

Used to generate the final output of all nodes before writing it to actual output stream (e.g. stdout)
*/

type Options = {
	width: number;
	height: number;
};

type Operation = WriteOperation | ClipOperation | UnclipOperation;

type WriteOperation = {
	type: 'write';
	x: number;
	y: number;
	text: string;
	transformers: OutputTransformer[];
	selectable?: boolean;
	semantic?: SemanticMetadata;
};

type ClipOperation = {
	type: 'clip';
	clip: Clip;
};

type Clip = {
	x1: number | undefined;
	x2: number | undefined;
	y1: number | undefined;
	y2: number | undefined;
};

type UnclipOperation = {
	type: 'unclip';
};

class OutputCaches {
	widths = new Map<string, number>();
	blockWidths = new Map<string, number>();
	styledChars = new Map<string, StyledChar[]>();

	getStyledChars(line: string): StyledChar[] {
		let cached = this.styledChars.get(line);
		if (cached === undefined) {
			cached = styledCharsFromTokens(tokenize(line));
			this.styledChars.set(line, cached);
		}

		return cached;
	}

	getStringWidth(text: string): number {
		let cached = this.widths.get(text);
		if (cached === undefined) {
			cached = stringWidth(text);
			this.widths.set(text, cached);
		}

		return cached;
	}

	getWidestLine(text: string): number {
		let cached = this.blockWidths.get(text);
		if (cached === undefined) {
			let lineWidth = 0;
			for (const line of text.split('\n')) {
				lineWidth = Math.max(lineWidth, this.getStringWidth(line));
			}

			cached = lineWidth;
			this.blockWidths.set(text, cached);
		}

		return cached;
	}
}

export default class Output {
	width: number;
	height: number;

	private readonly operations: Operation[] = [];
	private readonly caches: OutputCaches = new OutputCaches();

	constructor(options: Options) {
		const {width, height} = options;

		this.width = width;
		this.height = height;
	}

	write(
		x: number,
		y: number,
		text: string,
		options: {
			transformers: OutputTransformer[];
			selectable?: boolean;
			semantic?: SemanticMetadata;
		},
	): void {
		const {transformers, selectable, semantic} = options;

		if (!text) {
			return;
		}

		this.operations.push({
			type: 'write',
			x,
			y,
			text,
			transformers,
			selectable,
			semantic,
		});
	}

	clip(clip: Clip) {
		this.operations.push({
			type: 'clip',
			clip,
		});
	}

	unclip() {
		this.operations.push({
			type: 'unclip',
		});
	}

	get(selection?: ScreenSelection | null): {
		output: string;
		height: number;
		cells: FrameCell[][];
		boundaries: (FrameBoundary | null)[][];
	} {
		// Initialize output array with a specific set of rows, so that margin/padding at the bottom is preserved
		const output: FrameCell[][] = [];

		for (let y = 0; y < this.height; y++) {
			const row: FrameCell[] = [];

			for (let x = 0; x < this.width; x++) {
				row.push({
					type: 'char',
					value: ' ',
					fullWidth: false,
					styles: [],
					selectable: false,
					flowId: null,
				});
			}

			output.push(row);
		}

		const boundaries: (FrameBoundary | null)[][] = output.map(() =>
			Array.from({length: this.width}, () => null),
		);

		const clips: Clip[] = [];

		for (const operation of this.operations) {
			if (operation.type === 'clip') {
				clips.push(operation.clip);
			}

			if (operation.type === 'unclip') {
				clips.pop();
			}

			if (operation.type === 'write') {
				const {text, transformers, selectable, semantic} = operation;
				let {x, y} = operation;
				let lines = text.split('\n');
				let firstLineIndex = 0;

				const clip = clips.at(-1);

				if (clip) {
					const clipHorizontally =
						typeof clip?.x1 === 'number' && typeof clip?.x2 === 'number';

					const clipVertically =
						typeof clip?.y1 === 'number' && typeof clip?.y2 === 'number';

					// If text is positioned outside of clipping area altogether,
					// skip to the next operation to avoid unnecessary calculations
					if (clipHorizontally) {
						const width = this.caches.getWidestLine(text);

						if (x + width < clip.x1! || x > clip.x2!) {
							continue;
						}
					}

					if (clipVertically) {
						const height = lines.length;

						if (y + height < clip.y1! || y > clip.y2!) {
							continue;
						}
					}

					if (clipHorizontally) {
						lines = lines.map(line => {
							const from = x < clip.x1! ? clip.x1! - x : 0;
							const width = this.caches.getStringWidth(line);
							const to = x + width > clip.x2! ? clip.x2! - x : width;

							return sliceAnsi(line, from, to);
						});

						if (x < clip.x1!) {
							x = clip.x1!;
						}
					}

					if (clipVertically) {
						const from = y < clip.y1! ? clip.y1! - y : 0;
						const height = lines.length;
						const to = y + height > clip.y2! ? clip.y2! - y : height;

						lines = lines.slice(from, to);
						firstLineIndex = from;

						if (y < clip.y1!) {
							y = clip.y1!;
						}
					}
				}

				let offsetY = 0;

				for (let [index, line] of lines.entries()) {
					const currentLine = output[y + offsetY];

					// Line can be missing if `text` is taller than height of pre-initialized `this.output`
					if (!currentLine) {
						continue;
					}

					for (const transformer of transformers) {
						line = transformer(line, index);
					}

					const boundaryRow = boundaries[y + offsetY];

					if (boundaryRow) {
						const boundaryWidth = semantic
							? Math.max(1, this.caches.getStringWidth(line))
							: this.caches.getStringWidth(line);
						const boundaryOrigin = x;
						const startX = Math.max(0, boundaryOrigin, clip?.x1 ?? 0);
						const endX = Math.min(
							this.width,
							boundaryOrigin + boundaryWidth,
							clip?.x2 ?? this.width,
						);
						const sourceBoundary =
							semantic?.boundaries[firstLineIndex + index] ?? null;
						const boundary: FrameBoundary | null =
							sourceBoundary && semantic
								? {
										...sourceBoundary,
										flowId: semantic.flowId,
										selectable: semantic.selectable,
									}
								: null;

						for (let boundaryX = startX; boundaryX < endX; boundaryX++) {
							if (boundaryX < boundaryRow.length) {
								boundaryRow[boundaryX] = boundary;
							}
						}
					}

					const characters = this.caches.getStyledChars(line);
					let offsetX = x;

					const rowSelectable = semantic
						? semantic.selectable &&
							(semantic.selectableRows[firstLineIndex + index] ?? true)
						: (selectable ?? true);

					// Nothing to write (e.g. line was clipped away).
					if (characters.length === 0) {
						offsetY++;
						continue;
					}

					const spaceCell: FrameCell = {
						type: 'char',
						value: ' ',
						fullWidth: false,
						styles: [],
						selectable: false,
						flowId: null,
					};

					// Wide characters (e.g. CJK) occupy two cells: a leading
					// cell with the character and a trailing placeholder with
					// value ''. When an overlapping write lands in the middle
					// of a wide character, the boundary cells need cleanup so
					// the terminal never renders a half-visible wide character.
					if (
						currentLine[offsetX]?.value === '' &&
						offsetX > 0 &&
						this.caches.getStringWidth(currentLine[offsetX - 1]?.value ?? '') >
							1
					) {
						currentLine[offsetX - 1] = spaceCell;
					}

					for (const character of characters) {
						currentLine[offsetX] = {
							...character,
							selectable: rowSelectable,
							flowId: semantic?.flowId ?? null,
						};

						// Determine printed width using string-width to align with measurement
						const characterWidth = Math.max(
							1,
							this.caches.getStringWidth(character.value),
						);

						// For multi-column characters, clear following cells to avoid stray spaces/artifacts
						if (characterWidth > 1) {
							for (let index = 1; index < characterWidth; index++) {
								currentLine[offsetX + index] = {
									type: 'char',
									value: '',
									fullWidth: false,
									styles: character.styles,
									selectable: rowSelectable,
									flowId: semantic?.flowId ?? null,
								};
							}
						}

						offsetX += characterWidth;
					}

					if (currentLine[offsetX]?.value === '') {
						currentLine[offsetX] = spaceCell;
					}

					offsetY++;
				}
			}
		}

		// Apply the selection highlight before serialization. Selected slots are
		// replaced with new cell objects (never mutated in place) because cells
		// reference StyledChar objects cached and shared across identical lines,
		// so mutating one would leak the highlight onto other on-screen text.
		if (selection) {
			for (let y = 0; y < output.length; y++) {
				const row = output[y];
				if (!row) {
					continue;
				}

				for (let x = 0; x < row.length; x++) {
					if (!isCellSelected(x, y, selection)) {
						continue;
					}

					const cell = row[x];
					if (cell) {
						row[x] = {
							...cell,
							styles: [...(cell.styles ?? []), SELECTION_BG],
						};
					}
				}
			}
		}

		const generatedOutput = output
			.map(line => {
				// See https://github.com/vadimdemedes/ink/pull/564#issuecomment-1637022742
				const lineWithoutEmptyItems = line.filter(item => item !== undefined);

				return styledCharsToString(
					lineWithoutEmptyItems as StyledChar[],
				).trimEnd();
			})
			.join('\n');

		return {
			output: generatedOutput,
			height: output.length,
			cells: output,
			boundaries,
		};
	}
}
