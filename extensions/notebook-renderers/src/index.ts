/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ActivationFunction, OutputItem } from 'vscode-notebook-renderer';
import { handleANSIOutput } from './ansi';
import { truncatedArrayOfString } from './textHelper';

interface IDisposable {
	dispose(): void;
}

function renderImage(outputInfo: OutputItem, element: HTMLElement): IDisposable {
	const blob = new Blob([outputInfo.data()], { type: outputInfo.mime });
	const src = URL.createObjectURL(blob);
	const disposable = {
		dispose: () => {
			URL.revokeObjectURL(src);
		}
	};

	const image = document.createElement('img');
	image.src = src;
	const display = document.createElement('div');
	display.classList.add('display');
	display.appendChild(image);
	element.appendChild(display);

	return disposable;
}

const ttPolicy = window.trustedTypes?.createPolicy('notebookRenderer', {
	createHTML: value => value,
	createScript: value => value,
});

const preservedScriptAttributes: (keyof HTMLScriptElement)[] = [
	'type', 'src', 'nonce', 'noModule', 'async',
];

const domEval = (container: Element) => {
	const arr = Array.from(container.getElementsByTagName('script'));
	for (let n = 0; n < arr.length; n++) {
		const node = arr[n];
		const scriptTag = document.createElement('script');
		const trustedScript = ttPolicy?.createScript(node.innerText) ?? node.innerText;
		scriptTag.text = trustedScript as string;
		for (const key of preservedScriptAttributes) {
			const val = node[key] || node.getAttribute && node.getAttribute(key);
			if (val) {
				scriptTag.setAttribute(key, val as any);
			}
		}

		// TODO@connor4312: should script with src not be removed?
		container.appendChild(scriptTag).parentNode!.removeChild(scriptTag);
	}
};

function renderHTML(outputInfo: OutputItem, container: HTMLElement): void {
	const htmlContent = outputInfo.text();
	const element = document.createElement('div');
	const trustedHtml = ttPolicy?.createHTML(htmlContent) ?? htmlContent;
	element.innerHTML = trustedHtml as string;
	container.appendChild(element);
	domEval(element);
}

function renderJavascript(outputInfo: OutputItem, container: HTMLElement): void {
	const str = outputInfo.text();
	const scriptVal = `<script type="application/javascript">${str}</script>`;
	const element = document.createElement('div');
	const trustedHtml = ttPolicy?.createHTML(scriptVal) ?? scriptVal;
	element.innerHTML = trustedHtml as string;
	container.appendChild(element);
	domEval(element);
}

function renderError(outputInfo: OutputItem, container: HTMLElement): void {
	const element = document.createElement('div');
	container.appendChild(element);
	type ErrorLike = Partial<Error>;

	let err: ErrorLike;
	try {
		err = <ErrorLike>JSON.parse(outputInfo.text());
	} catch (e) {
		console.log(e);
		return;
	}

	if (err.stack) {
		const stack = document.createElement('pre');
		stack.classList.add('traceback');
		stack.style.margin = '8px 0';
		stack.appendChild(handleANSIOutput(err.stack));
		container.appendChild(stack);
	} else {
		const header = document.createElement('div');
		const headerMessage = err.name && err.message ? `${err.name}: ${err.message}` : err.name || err.message;
		if (headerMessage) {
			header.innerText = headerMessage;
			container.appendChild(header);
		}
	}

	container.classList.add('error');
}

function renderStream(outputInfo: OutputItem, container: HTMLElement, error: boolean): void {
	const outputContainer = container.parentElement;
	if (!outputContainer) {
		// should never happen
		return;
	}

	const prev = outputContainer.previousSibling;
	if (prev) {
		// OutputItem in the same cell
		// check if the previous item is a stream
		const outputElement = (prev.firstChild as HTMLElement | null);
		if (outputElement && outputElement.getAttribute('output-mime-type') === outputInfo.mime) {
			// same stream
			const text = outputInfo.text();

			const element = document.createElement('span');
			truncatedArrayOfString([text], 30, element);
			outputElement.appendChild(element);
			return;
		}
	}

	const element = document.createElement('span');
	element.classList.add('output-stream');

	const text = outputInfo.text();
	truncatedArrayOfString([text], 30, element);
	container.appendChild(element);
	container.setAttribute('output-mime-type', outputInfo.mime);
	if (error) {
		container.classList.add('error');
	}
}

function renderText(outputInfo: OutputItem, container: HTMLElement): void {
	const contentNode = document.createElement('div');
	contentNode.classList.add('.output-plaintext');
	const text = outputInfo.text();
	truncatedArrayOfString([text], 30, contentNode);
	container.appendChild(contentNode);

}

export const activate: ActivationFunction<void> = (ctx) => {
	const disposables = new Map<string, IDisposable>();

	return {
		renderOutputItem: (outputInfo, element) => {
			switch (outputInfo.mime) {
				case 'text/html':
				case 'image/svg+xml':
					{
						if (!ctx.workspace.isTrusted) {
							return;
						}

						renderHTML(outputInfo, element);
					}
					break;
				case 'application/javascript':
					{
						if (!ctx.workspace.isTrusted) {
							return;
						}

						renderJavascript(outputInfo, element);
					}
					break;
				case 'image/gif':
				case 'image/png':
				case 'image/jpeg':
				case 'image/git':
					{
						const disposable = renderImage(outputInfo, element);
						disposables.set(outputInfo.id, disposable);
					}
					break;
				case 'application/vnd.code.notebook.error':
					{
						renderError(outputInfo, element);
					}
					break;
				case 'application/vnd.code.notebook.stdout':
				case 'application/x.notebook.stdout':
				case 'application/x.notebook.stream':
					{
						renderStream(outputInfo, element, false);
					}
					break;
				case 'application/vnd.code.notebook.stderr':
				case 'application/x.notebook.stderr':
					{
						renderStream(outputInfo, element, true);
					}
					break;
				case 'text/plain':
					{
						renderText(outputInfo, element);
					}
					break;
				default:
					break;
			}


		},
		disposeOutputItem: (id: string | undefined) => {
			if (id) {
				disposables.get(id)?.dispose();
			} else {
				disposables.forEach(d => d.dispose());
			}
		}
	};
};
