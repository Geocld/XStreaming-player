import BaseChannel from './Base'

type HandshakeAckMessage = {
    type: 'HandshakeAck';
    version: string;
    id: string;
    cv: string;
}

type FireAndForgetMessage = {
    type: 'Message';
    id: string;
    target: string;
    content: string;
    cv: string;
}

type TransactionStartMessage = {
    type: 'TransactionStart';
    id: string;
    target: string;
    content: string;
    cv: string;
}

type TransactionCompleteMessage = {
    type: 'TransactionComplete';
    id: string;
    content: string;
    cv: string;
}

type ReceiverCancelMessage = {
    type: 'ReceiverCancel';
    id: string;
    content?: string;
    cv: string;
}

type SenderCancelMessage = {
    type: 'SenderCancel';
    id: string;
    content?: string;
    cv: string;
}

type UnhandledTargetMessage = {
    type: 'Unhandled';
    id: string;
    target: string;
    cv: string;
}

type ErrorMessage = {
    type: 'Error';
    id: string;
    content: string;
    cv: string;
}

type AnyIncomingMessage =
    | HandshakeAckMessage
    | FireAndForgetMessage
    | TransactionStartMessage
    | TransactionCompleteMessage
    | ReceiverCancelMessage
    | SenderCancelMessage
    | UnhandledTargetMessage
    | ErrorMessage

type PendingTransaction = {
    resolve: (value: string) => void;
    reject: (reason: any) => void;
    target: string;
}

const HANDSHAKE_VERSION = 'messageV1'
const SYSTEM_UI_SCOPE = '/streaming/systemUi/messages/'
const TOUCHCONTROLS_SCOPE = '/streaming/touchcontrols'
const DEFAULT_SUPPORTED_SYSTEM_UIS = [10, 19, 31, 27, 32, -44, 40, 41, -43]

export default class MessageChannel extends BaseChannel {
    _handshakeReady = false
    _cvPrefix = this._newId().replace(/-/g, '')
    _cvCounter = 0
    _messageQueue:Array<{ target: string; data: any }> = []
    _openTransactions = new Map<string, PendingTransaction>()
    _incomingTransactionCancellationCallbacks = new Map<string, (() => void) | undefined>()
    _clientInstallId = this._newId()

    onOpen(event) {
        super.onOpen(event)

        const handshake = JSON.stringify({
            type: 'Handshake',
            version: HANDSHAKE_VERSION,
            id: this._newId(),
            cv: this._nextCv(),
        })
        this.send(handshake)
    }
    
    onMessage(event) {
        const message = this._parseIncomingMessage(event)
        if (!message) {
            return
        }

        switch (message.type) {
            case 'HandshakeAck':
                this._onHandshakeAck(message)
                break
            case 'Message':
                this._onFireAndForget(message)
                break
            case 'TransactionStart':
                this._onTransactionStart(message)
                break
            case 'TransactionComplete':
                this._onTransactionComplete(message)
                break
            case 'SenderCancel':
                this._onSenderCancel(message)
                break
            case 'ReceiverCancel':
                this._onReceiverCancel(message)
                break
            case 'Unhandled':
                this._onUnhandled(message)
                break
            case 'Error':
                this._onError(message)
                break
            default:
                console.log('xStreamingPlayer Channel/Message.ts - Unknown message type:', message)
                break
        }

        if (message.type === 'Message' && typeof message.target === 'string' && message.target.includes('/titleinfo')) {
            try {
                const content = this._parseContent(message.content)
                const xboxTitleId = parseInt(content.titleid, 16)
                window._xboxTitleId = xboxTitleId
            } catch (error) {
                console.warn('xStreamingPlayer Channel/Message.ts - Failed to parse titleinfo:', error)
            }
        }

        this.getClient().getEventBus().emit('message', {
            ...message,
        })
    }

    onClose(event) {
        this._resetRuntimeState()
        super.onClose(event)
    }

    destroy() {
        this._resetRuntimeState()
        super.destroy()
    }

    sendMessage(path: string, data: any) {
        if (!this._handshakeReady) {
            this._messageQueue.push({ target: path, data })
            return
        }

        this.send(
            JSON.stringify({
                type: 'Message',
                content: this._stringifyContent(data),
                id: this._newId(),
                target: path,
                cv: this._nextCv(),
            }),
        )
    }

    sendTransaction(path: string, data: any) {
        if (!path.startsWith('/')) {
            this.sendTransactionComplete(path, data)
            return Promise.resolve('')
        }

        return new Promise<string>((resolve, reject) => {
            if (!this._handshakeReady) {
                reject({
                    message: `message channel not ready to send target: ${path}`,
                })
                return
            }

            const id = this._newId()
            this._openTransactions.set(id, { resolve, reject, target: path })

            try {
                this.send(
                    JSON.stringify({
                        type: 'TransactionStart',
                        content: this._stringifyContent(data),
                        id,
                        target: path,
                        cv: this._nextCv(),
                    }),
                )
            } catch (error) {
                this._openTransactions.delete(id)
                reject(error)
            }
        })
    }

    sendTransactionComplete(id: string, data: any) {
        this.send(
            JSON.stringify({
                type: 'TransactionComplete',
                content: this._stringifyContent(data),
                id,
                cv: this._nextCv(),
            }),
        )
    }

    generateMessage(path, data) {
        return {
            type: 'Message',
            content: this._stringifyContent(data),
            id: this._newId(),
            target: path,
            cv: this._nextCv(),
        }
    }

    _onHandshakeAck(message: HandshakeAckMessage) {
        if (message.version !== HANDSHAKE_VERSION) {
            console.warn(
                `xStreamingPlayer Channel/Message.ts - Handshake version mismatch. expected=${HANDSHAKE_VERSION}, actual=${message.version}`,
            )
            return
        }

        if (this._handshakeReady) {
            return
        }

        this._handshakeReady = true

        this.getClient().getChannelProcessor('control').start()
        this.getClient().getChannelProcessor('input').start()

        const systemVersion = this.getClient()._config.ui_version || [0, 2, 0]
        this.sendMessage('/streaming/systemUi/configuration', {
            version: systemVersion,
            systemUis: this._getSupportedSystemUis(),
        })

        this.sendMessage('/streaming/properties/clientappinstallidchanged', {
            clientAppInstallId: this._clientInstallId,
        })

        this.sendMessage('/streaming/characteristics/orientationchanged', {
            orientation: 0,
        })

        this.sendMessage('/streaming/characteristics/touchinputenabledchanged', {
            touchInputEnabled: (this.getClient().getMaxTouchPoints?.() ?? 0) > 0,
        })

        this.sendMessage('/streaming/characteristics/clientdevicecapabilities', {})

        this.sendMessage('/streaming/characteristics/dimensionschanged', {
            horizontal: 1920,
            vertical: 1080,
            preferredWidth: 1920,
            preferredHeight: 1080,
            safeAreaLeft: 0,
            safeAreaTop: 0,
            safeAreaRight: 1920,
            safeAreaBottom: 1080,
            supportsCustomResolution: true,
        })

        this._drainQueue()
    }

    _onFireAndForget(message: FireAndForgetMessage) {
        const handled = this._dispatchIncomingTarget({
            target: message.target,
            id: message.id,
            content: message.content,
            isTransaction: false,
        })

        if (!handled) {
            this._sendUnhandled(message)
        }
    }

    _onTransactionStart(message: TransactionStartMessage) {
        let localCv = this._incrementCv(message.cv)
        let isActive = true
        this._incomingTransactionCancellationCallbacks.set(message.id, undefined)

        const completion = {
            cancel: (reason?: any) => {
                if (!isActive) {
                    return
                }
                isActive = false
                localCv = this._incrementCv(localCv)
                this.send(
                    JSON.stringify({
                        type: 'ReceiverCancel',
                        id: message.id,
                        content: reason ? this._stringifyContent(reason) : undefined,
                        cv: localCv,
                    }),
                )
                this._incomingTransactionCancellationCallbacks.delete(message.id)
            },
            complete: (content: any) => {
                if (!isActive) {
                    return
                }
                isActive = false
                localCv = this._incrementCv(localCv)
                this.send(
                    JSON.stringify({
                        type: 'TransactionComplete',
                        content: this._stringifyContent(content),
                        id: message.id,
                        cv: localCv,
                    }),
                )
                this._incomingTransactionCancellationCallbacks.delete(message.id)
            },
            setOnRemoteCancellation: (callback: () => void) => {
                this._incomingTransactionCancellationCallbacks.set(message.id, callback)
            },
        }

        try {
            const handled = this._dispatchIncomingTarget({
                target: message.target,
                id: message.id,
                content: message.content,
                isTransaction: true,
                completion,
            })
            if (!handled) {
                this._incomingTransactionCancellationCallbacks.delete(message.id)
                this._sendUnhandled(message)
            }
        } catch (error) {
            this._incomingTransactionCancellationCallbacks.delete(message.id)
            this._sendError(message.id, error, localCv)
        }
    }

    _onTransactionComplete(message: TransactionCompleteMessage) {
        const pending = this._openTransactions.get(message.id)
        if (!pending) {
            return
        }

        pending.resolve(message.content)
        this._openTransactions.delete(message.id)
    }

    _onSenderCancel(message: SenderCancelMessage) {
        const callback = this._incomingTransactionCancellationCallbacks.get(message.id)
        callback?.()
        this._incomingTransactionCancellationCallbacks.delete(message.id)
    }

    _onReceiverCancel(message: ReceiverCancelMessage) {
        const pending = this._openTransactions.get(message.id)
        if (!pending) {
            return
        }
        pending.reject({
            message: 'Transaction cancelled by receiver',
            reason: message.content,
        })
        this._openTransactions.delete(message.id)
    }

    _onUnhandled(message: UnhandledTargetMessage) {
        const pending = this._openTransactions.get(message.id)
        if (pending) {
            pending.reject({
                message: `No handler found for target: ${message.target}`,
            })
            this._openTransactions.delete(message.id)
            return
        }

        console.warn(`xStreamingPlayer Channel/Message.ts - Unhandled message for target: ${message.target}`)
    }

    _onError(message: ErrorMessage) {
        const pending = this._openTransactions.get(message.id)
        if (pending) {
            pending.reject({
                message: 'Remote side returned an error',
                reason: message.content,
            })
            this._openTransactions.delete(message.id)
            return
        }

        console.warn('xStreamingPlayer Channel/Message.ts - Remote error:', message.content)
    }

    _dispatchIncomingTarget({
        target,
        id,
        content,
        isTransaction,
        completion,
    }: {
        target: string;
        id: string;
        content: string;
        isTransaction: boolean;
        completion?: {
            complete: (response: any) => void;
            cancel: (reason?: any) => void;
            setOnRemoteCancellation: (callback: () => void) => void;
        };
    }): boolean {
        const parsedPayload = this._parseContent(content)
        const handlerPayload = {
            id,
            target,
            content,
            payload: parsedPayload,
            isTransaction,
            completion,
        }

        const maxTouchPoints = this.getClient().getMaxTouchPoints?.() ?? 0
        if (target.startsWith(TOUCHCONTROLS_SCOPE) && maxTouchPoints === 0) {
            if (isTransaction && completion && typeof completion.cancel === 'function') {
                completion.cancel()
            }
            return true
        }

        const genericMessageHandler = this.getClient().getMessageHandler?.()

        if (target.startsWith(SYSTEM_UI_SCOPE)) {
            const systemUiHandler = this.getClient().getSystemUiHandler?.()
            if (systemUiHandler) {
                const handled = systemUiHandler(handlerPayload)
                if (handled !== false) {
                    return true
                }
            }
        }

        if (genericMessageHandler) {
            const handled = genericMessageHandler(handlerPayload)
            if (handled !== false) {
                return true
            }
        }

        const eventBus = this.getClient().getEventBus?.()
        const hasListeners =
            eventBus &&
            typeof eventBus.listenerCount === 'function' &&
            eventBus.listenerCount('messageTarget') > 0
        if (hasListeners && typeof eventBus.emit === 'function') {
            eventBus.emit('messageTarget', handlerPayload)
            return true
        }

        return false
    }

    _sendUnhandled(message: FireAndForgetMessage | TransactionStartMessage) {
        this.send(
            JSON.stringify({
                type: 'Unhandled',
                id: message.id,
                target: message.target,
                cv: this._incrementCv(message.cv),
            }),
        )
    }

    _sendError(id: string, error: unknown, cv: string) {
        try {
            this.send(
                JSON.stringify({
                    type: 'Error',
                    id,
                    content: this._stringifyContent(error),
                    cv,
                }),
            )
        } catch (sendError) {
            console.warn('xStreamingPlayer Channel/Message.ts - Failed to send Error message:', sendError)
        }
    }

    _getSupportedSystemUis() {
        const supportedSystemUis = this.getClient().getSupportedSystemUis?.()
        if (Array.isArray(supportedSystemUis)) {
            return supportedSystemUis
        }
        return DEFAULT_SUPPORTED_SYSTEM_UIS
    }

    _drainQueue() {
        if (!this._messageQueue.length) {
            return
        }
        const queue = [...this._messageQueue]
        this._messageQueue = []
        queue.forEach(item => {
            this.sendMessage(item.target, item.data)
        })
    }

    _resetRuntimeState() {
        this._handshakeReady = false
        this._messageQueue = []
        this._openTransactions.forEach(pending => {
            pending.reject({
                message: 'message channel closed',
            })
        })
        this._openTransactions.clear()
        this._incomingTransactionCancellationCallbacks.clear()
    }

    _parseIncomingMessage(event): AnyIncomingMessage | null {
        const raw = this._decodeRawData(event?.data)
        if (!raw) {
            return null
        }

        try {
            const nullChar = String.fromCharCode(0)
            const cleanData = raw.split(nullChar).join('').trim()
            if (!cleanData) {
                return null
            }

            const parsedMessage = JSON.parse(cleanData) as AnyIncomingMessage
            return parsedMessage
        } catch (error) {
            console.warn('xStreamingPlayer Channel/Message.ts - Invalid json message:', raw, error)
            return null
        }
    }

    _decodeRawData(data): string {
        if (typeof data === 'string') {
            return data
        }

        if (data instanceof ArrayBuffer) {
            return new TextDecoder().decode(new Uint8Array(data))
        }

        if (ArrayBuffer.isView(data)) {
            return new TextDecoder().decode(data as Uint8Array)
        }

        if (typeof data === 'object' && data !== null) {
            return JSON.stringify(data)
        }

        return ''
    }

    _parseContent(content: string) {
        if (typeof content !== 'string') {
            return content
        }
        try {
            return JSON.parse(content)
        } catch (_error) {
            return content
        }
    }

    _stringifyContent(content: any) {
        if (typeof content === 'string') {
            return content
        }
        return JSON.stringify(content ?? {})
    }

    _newId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID()
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            const v = c === 'x' ? r : (r & 0x3 | 0x8)
            return v.toString(16)
        })
    }

    _nextCv() {
        this._cvCounter += 1
        return `${this._cvPrefix}.${this._cvCounter}`
    }

    _incrementCv(cv: string) {
        if (!cv || typeof cv !== 'string') {
            return this._nextCv()
        }

        const parts = cv.split('.')
        const last = Number(parts[parts.length - 1])
        if (Number.isFinite(last)) {
            parts[parts.length - 1] = String(last + 1)
            return parts.join('.')
        }

        return `${cv}.1`
    }
}
