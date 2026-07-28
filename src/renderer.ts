import renderNodeToOutput, {
	renderNodeToScreenReaderOutput,
} from './render-node-to-output.js';
import Output from './output.js';
import {type DOMElement} from './dom.js';
import {
	type ScreenSelection,
	type FrameCell,
	type FrameBoundary,
} from './frame-controller.js';

type Result = {
	output: string;
	outputHeight: number;
	staticOutput: string;
	cells?: FrameCell[][];
	boundaries?: Array<Array<FrameBoundary | undefined>>;
};

const renderer = (
	node: DOMElement,
	isScreenReaderEnabled: boolean,
	selection?: ScreenSelection,
): Result => {
	if (node.yogaNode) {
		if (isScreenReaderEnabled) {
			const output = renderNodeToScreenReaderOutput(node, {
				skipStaticElements: true,
			});

			const outputHeight = output === '' ? 0 : output.split('\n').length;

			let staticOutput = '';

			if (node.staticNode) {
				staticOutput = renderNodeToScreenReaderOutput(node.staticNode, {
					skipStaticElements: false,
				});
			}

			return {
				output,
				outputHeight,
				staticOutput: staticOutput ? `${staticOutput}\n` : '',
			};
		}

		const output = new Output({
			width: node.yogaNode.getComputedWidth(),
			height: node.yogaNode.getComputedHeight(),
		});

		const flowIds = new Map<unknown, number>();
		const nextFlowId = {value: 1};

		renderNodeToOutput(node, output, {
			skipStaticElements: true,
			flowIds,
			nextFlowId,
		});

		let staticOutput;

		if (node.staticNode?.yogaNode) {
			staticOutput = new Output({
				width: node.staticNode.yogaNode.getComputedWidth(),
				height: node.staticNode.yogaNode.getComputedHeight(),
			});

			renderNodeToOutput(node.staticNode, staticOutput, {
				skipStaticElements: false,
				flowIds,
				nextFlowId,
			});
		}

		const {
			output: generatedOutput,
			height: outputHeight,
			cells,
			boundaries,
		} = output.get(selection);

		return {
			output: generatedOutput,
			outputHeight,
			// Newline at the end is needed, because static output doesn't have one, so
			// interactive output will override last line of static output
			staticOutput: staticOutput ? `${staticOutput.get().output}\n` : '',
			cells,
			boundaries,
		};
	}

	return {
		output: '',
		outputHeight: 0,
		staticOutput: '',
	};
};

export default renderer;
