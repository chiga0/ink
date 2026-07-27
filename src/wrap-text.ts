import wrapAnsi from 'wrap-ansi';
import cliTruncate from 'cli-truncate';
import stripAnsi from 'strip-ansi';
import {type Styles} from './styles.js';

const cache: Record<string, string> = {};

const wrapText = (
	text: string,
	maxWidth: number,
	wrapType: Styles['textWrap'],
): string => {
	const cacheKey = text + String(maxWidth) + String(wrapType);
	const cachedText = cache[cacheKey];

	if (cachedText) {
		return cachedText;
	}

	let wrappedText = text;

	if (wrapType === 'wrap') {
		wrappedText = wrapAnsi(text, maxWidth, {
			trim: false,
			hard: true,
		});
	}

	if (wrapType === 'hard') {
		wrappedText = wrapAnsi(text, maxWidth, {
			trim: false,
			hard: true,
			wordWrap: false,
		});
	}

	if (wrapType!.startsWith('truncate')) {
		let position: 'end' | 'middle' | 'start' = 'end';

		if (wrapType === 'truncate-middle') {
			position = 'middle';
		}

		if (wrapType === 'truncate-start') {
			position = 'start';
		}

		wrappedText = cliTruncate(text, maxWidth, {position});
	}

	cache[cacheKey] = wrappedText;

	return wrappedText;
};

export type TextBoundary = {
	kind: 'soft' | 'hard';
	joiner: string;
};

export const wrapTextWithMetadata = (
	text: string,
	maxWidth: number,
	wrapType: Styles['textWrap'],
	shouldWrap = true,
): {text: string; boundaries: TextBoundary[]; selectableRows: boolean[]} => {
	const sourceLines = text.replaceAll('\r\n', '\n').split('\n');
	const lines: string[] = [];
	const boundaries: TextBoundary[] = [];
	const selectableRows: boolean[] = [];

	for (const [sourceLineIndex, sourceLine] of sourceLines.entries()) {
		const wrappedLines = (
			shouldWrap ? wrapText(sourceLine, maxWidth, wrapType) : sourceLine
		).split('\n');
		const visibleSource = stripAnsi(sourceLine);
		let sourceOffset = 0;

		for (const [wrappedLineIndex, wrappedLine] of wrappedLines.entries()) {
			const visibleLine = stripAnsi(wrappedLine);

			const separatorRow =
				sourceOffset > 0 &&
				visibleLine.length > 0 &&
				/^\s+$/u.test(visibleLine) &&
				/\S/u.test(visibleSource.slice(sourceOffset));

			const sourceSeparator = separatorRow
				? (/^\s+/u.exec(visibleSource.slice(sourceOffset))?.[0] ?? '').slice(
						0,
						visibleLine.length,
					)
				: '';

			const lineOffset = separatorRow
				? sourceOffset
				: visibleSource.indexOf(visibleLine, sourceOffset);
			const resolvedOffset = lineOffset === -1 ? sourceOffset : lineOffset;

			if (lines.length > 0) {
				boundaries.push({
					kind: wrappedLineIndex === 0 ? 'hard' : 'soft',
					joiner:
						wrappedLineIndex === 0
							? '\n'
							: separatorRow
								? sourceSeparator
								: visibleSource.slice(sourceOffset, resolvedOffset),
				});
			}

			lines.push(wrappedLine);
			selectableRows.push(!separatorRow);
			sourceOffset = separatorRow
				? sourceOffset + sourceSeparator.length
				: resolvedOffset + visibleLine.length;
		}

		if (sourceLineIndex < sourceLines.length - 1 && wrappedLines.length === 0) {
			lines.push('');
		}
	}

	return {text: lines.join('\n'), boundaries, selectableRows};
};

export default wrapText;
