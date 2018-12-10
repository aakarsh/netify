export enum ErrorReasons {
	Failed = 'Failed',
	Aborted = 'Aborted',
	TimedOut = 'TimedOut',
	AccessDenied = 'AccessDenied',
	ConnectionClosed = 'ConnectionClosed',
	ConnectionReset = 'ConnectionReset',
	ConnectionRefused = 'ConnectionRefused',
	ConnectionAborted = 'ConnectionAborted',
	ConnectionFailed = 'ConnectionFailed',
	NameNotResolved = 'NameNotResolved',
	InternetDisconnected = 'InternetDisconnected',
	AddressUnreachable = 'AddressUnreachable',
	BlockedByClient = 'BlockedByClient',
	BlockedByResponse = 'BlockedByResponse',
}

export const errorReasonsList = [
	ErrorReasons.Failed,
	ErrorReasons.Aborted,
	ErrorReasons.TimedOut,
	ErrorReasons.AccessDenied,
	ErrorReasons.ConnectionClosed,
	ErrorReasons.ConnectionReset,
	ErrorReasons.ConnectionRefused,
	ErrorReasons.ConnectionAborted,
	ErrorReasons.ConnectionFailed,
	ErrorReasons.NameNotResolved,
	ErrorReasons.InternetDisconnected,
	ErrorReasons.AddressUnreachable,
	ErrorReasons.BlockedByClient,
	ErrorReasons.BlockedByResponse,
];
