import {
	buildRequestBodyFromMultipartForm,
	buildRequestBodyFromUrlEncodedForm,
	compileRawResponseFromBase64Body,
	compileRawResponseFromBlobBody,
	compileRawResponseFromTextBody,
	mutateHeaders,
} from './helpers/http';
import {compileUrlFromPattern} from './helpers/url';
import {randomHex} from '@/helpers/random'; // Todo to one helpers dir
import {RequestBodyType} from './constants/RequestBodyType';
import {RulesManager} from './interfaces/RulesManager';
import {ResponseBodyType} from '@/debugger/constants/ResponseBodyType';
import {Log} from './interfaces/Log';
import {
	RequestEventParams,
	CompletedRequestEventParams,
	ContinueRequestParams,
	GetInterceptedBodyResponse,
} from './interfaces/chromeInternal';


//TODO work with redirects
//TODO work with forms (formdata/ multipart)

const interceptPatterns = [{
	urlPattern: '*',
	interceptionStage: 'Request',
}, {
	urlPattern: '*',
	interceptionStage: 'HeadersReceived',
}];


export enum DebuggerState {
	Active,
	Inactive,
	Starting,
	Stopping,
}

export interface DebuggerConfig {
	tabId: number,
	rulesManager: RulesManager,
	onRequestStart: (data: Log) => any;
	onRequestEnd: (id: Log['id']) => any;
	onUserDetach: () => any; // When user manually destroy debugger by Chrome warning-panel
}


//TODO replace request method
export default class Debugger {
	private readonly debuggerVersion = '1.3';

	private readonly debugTarget: {tabId: number};
	private rulesManager: RulesManager;
	private readonly onRequestStart: DebuggerConfig['onRequestStart'];
	private readonly onRequestEnd: DebuggerConfig['onRequestEnd'];
	private readonly onUserDetach: DebuggerConfig['onUserDetach'];

	state = DebuggerState.Inactive;

	constructor({tabId, rulesManager, onRequestStart, onRequestEnd, onUserDetach}: DebuggerConfig) {
		this.debugTarget = {tabId};
		this.rulesManager = rulesManager;
		this.onRequestStart = onRequestStart;
		this.onRequestEnd = onRequestEnd;
		this.onUserDetach = onUserDetach;

		chrome.debugger.onDetach.addListener(this.detachHandler);
	}

	async initialize() {
		this.state = DebuggerState.Starting;
		await this.attach();
		await this.sendCommand('Network.setRequestInterception', {patterns: interceptPatterns});
		chrome.debugger.onEvent.addListener(this.messageHandler);
		this.state = DebuggerState.Active;
	}

	private attach() {
		return new Promise((resolve, reject) => {
			chrome.debugger.attach(this.debugTarget, this.debuggerVersion, () => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
				} else {
					resolve();
				}
			});
		});
	}

	destroy() {
		this.state = DebuggerState.Stopping;

		return new Promise((resolve, reject) => {
			chrome.debugger.detach(this.debugTarget, () => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
				} else {
					resolve();
				}
				this.state = DebuggerState.Inactive;
			});
		});
	}

	private sendCommand<TResult = any>(command: string, params: object): Promise<TResult> {
		return new Promise(resolve => {
			return chrome.debugger.sendCommand(this.debugTarget, command, params, (result: any) => {
				resolve(result as TResult);
			});
		});
	}

	private detachHandler = ({tabId}: {tabId?: number}) => {
		if (tabId === this.debugTarget.tabId && [DebuggerState.Active, DebuggerState.Starting].includes(this.state)) {
			this.onUserDetach();
		}
	};

	private messageHandler = async (_source: any, method: string, params: any) => {
		if(method === 'Network.requestIntercepted') {
			if (params.hasOwnProperty('responseStatusCode')) {
				await this.handleServerResponse(params);
			} else {
				await this.handleClientRequest(params);
			}
		}
	};

	private async handleClientRequest({interceptionId, request, resourceType}: RequestEventParams) {
		const rule = this.rulesManager.selectOne({...request, resourceType});

		// skip if none rule for the request
		if (!rule) {
			await this.continueIntercepted({interceptionId});
			return;
		}

		// notify the owner about new request
		this.onRequestStart({
			id: interceptionId,
			ruleId: rule.id,
			loaded: false,
			date: new Date(),
			url: request.url,
			method: request.method,
			resourceType: request.resourceType,
		});

		const {mutateRequest, mutateResponse, cancelRequest} = rule.actions;


		// is defined response error and required local response, return error reason on the request stage
		if (cancelRequest.enabled) {
			await this.continueIntercepted({interceptionId, errorReason: cancelRequest.reason});
			this.onRequestEnd(interceptionId);
			return;
		}


		// if required local response, combine the response form defined status, headers and body
		if (mutateResponse.enabled && mutateResponse.responseLocally) {
			const {headers, replaceBody} = mutateResponse;
			const statusCode = mutateResponse.statusCode || 200;

			let rawResponse;
			switch (replaceBody.type) {
				case ResponseBodyType.Original:
					rawResponse = compileRawResponseFromTextBody(statusCode, headers.add, '');
					break;

				case ResponseBodyType.Text:
					rawResponse = compileRawResponseFromTextBody(statusCode, headers.add, replaceBody.textValue);
					break;

				case ResponseBodyType.Base64:
					rawResponse = compileRawResponseFromBase64Body(statusCode, headers.add, replaceBody.textValue);
					break;

				case ResponseBodyType.Blob:
					rawResponse = replaceBody.blobValue
						? await compileRawResponseFromBlobBody(statusCode, headers.add, replaceBody.blobValue)
						: compileRawResponseFromTextBody(statusCode, headers.add, ''); // not defined blob is equal ro an empty body
					break;
			}

			await this.continueIntercepted({interceptionId, rawResponse});
			this.onRequestEnd(interceptionId);
			return;
		}


		const continueParams: ContinueRequestParams = {interceptionId};

		if (!mutateRequest.enabled) {
			await this.continueIntercepted({interceptionId});
			return;
		}

		// rewrite request params before send to server
		// first, rewrite endpoint url
		if (mutateRequest.endpointReplace) {
			continueParams.url = compileUrlFromPattern(mutateRequest.endpointReplace, request.url);
		}

		// then, mutate headers
		if (Reflect.ownKeys(mutateRequest.headers.add).length || mutateRequest.headers.remove.length) {
			const {add, remove} = mutateRequest.headers;
			continueParams.headers = mutateHeaders(request.headers, add, remove);
		}

		// then, rewrite body
		if (mutateRequest.replaceBody.type !== RequestBodyType.Original) {
			const {type, textValue, formValue} = mutateRequest.replaceBody;
			let contentType = 'text/plain;charset=UTF-8';

			//TODO check postData with get/delete methods
			switch (type) {
				case RequestBodyType.Text:
					continueParams.postData = textValue;
					break;

				case RequestBodyType.UrlEncodedForm:
					continueParams.postData = buildRequestBodyFromUrlEncodedForm(formValue);
					contentType = 'application/x-www-form-urlencoded';
					break;

				case RequestBodyType.MultipartFromData:
					const boundary = '----NetifyBoundary' + randomHex(24);
					continueParams.postData = buildRequestBodyFromMultipartForm(formValue, boundary);
					contentType = 'multipart/form-data; boundary=' + boundary;
					break;
			}

			// calculate post data length in octets (bytes)
			const contentLength = new TextEncoder().encode(continueParams.postData).length.toString();

			continueParams.headers = mutateHeaders(continueParams.headers || request.headers, {
				'Content-Type': contentType,
				'Content-Length': contentLength,
			}, []);
		}


		await this.continueIntercepted(continueParams);
	}

	private async handleServerResponse(params: CompletedRequestEventParams) {
		const {interceptionId, request, resourceType, responseHeaders, responseStatusCode} = params;
		const rule = this.rulesManager.selectOne({...request, resourceType});

		// skip if none rule for the request
		if (!rule) {
			await this.continueIntercepted({interceptionId});
			return;
		}

		const {mutateResponse} = rule.actions;
		const skipHandler = mutateResponse.statusCode === null
			&& Reflect.ownKeys(mutateResponse.headers.add).length === 0
			&& mutateResponse.headers.remove.length === 0
			&& mutateResponse.replaceBody.type === ResponseBodyType.Original;

		if (!mutateResponse.enabled || skipHandler) {
			await this.continueIntercepted({interceptionId});
			this.onRequestEnd(interceptionId);
			return;
		}

		// define status code
		let newStatusCode = mutateResponse.statusCode === null
			? responseStatusCode
			: mutateResponse.statusCode;


		// defined mutated headers
		const newHeaders = mutateHeaders(
			responseHeaders,
			mutateResponse.headers.add,
			mutateResponse.headers.remove,
		);

		// TODO maybe handle response without full rebuild if body not changed

		// define response body from the rules or extract from the server response
		let newBodyType;
		let newBodyTextValue;
		let newBodyBlobValue: Blob | undefined;
		if (mutateResponse.replaceBody.type !== ResponseBodyType.Original) {
			newBodyType = mutateResponse.replaceBody.type;
			newBodyTextValue = mutateResponse.replaceBody.textValue;
			newBodyBlobValue = mutateResponse.replaceBody.blobValue;
		} else {
			const {body, base64Encoded} = await this.sendCommand<GetInterceptedBodyResponse>(
				'Network.getResponseBodyForInterception',
				{interceptionId}
			);
			newBodyType = base64Encoded
				? ResponseBodyType.Base64
				: ResponseBodyType.Text;
			newBodyTextValue = await body;
		}

		// combine rawResponse from new body, old and new headers, and status code
		let rawResponse;
		switch (newBodyType) {
			case ResponseBodyType.Text:
				rawResponse = compileRawResponseFromTextBody(newStatusCode, newHeaders, newBodyTextValue);
				break;

			case ResponseBodyType.Base64:
				rawResponse = compileRawResponseFromBase64Body(newStatusCode, newHeaders, newBodyTextValue);
				break;

			case ResponseBodyType.Blob:
				rawResponse = newBodyBlobValue
					? await compileRawResponseFromBlobBody(newStatusCode, newHeaders, newBodyBlobValue)
					: compileRawResponseFromTextBody(newStatusCode, newHeaders, ''); // not defined blob is equal to an empty body
				break;
		}

		await this.continueIntercepted({interceptionId, rawResponse});
		this.onRequestEnd(interceptionId);
	}

	private async continueIntercepted(params: ContinueRequestParams, waitTime?: number) {
		const continueCommand = () => {
			return this.sendCommand('Network.continueInterceptedRequest', params).then( /* TODO check response */);
		};

		if (waitTime) {
			// TODO implement throttling
		} else {
			await continueCommand();
		}
	}
}