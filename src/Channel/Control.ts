import BaseChannel from './Base'

export default class ControlChannel extends BaseChannel {
    _gamepadSyncTimeout: any = null

    onOpen(event) {
        super.onOpen(event)
        // console.log('xStreamingPlayer Channel/Control.ts - ['+this._channelName+'] onOpen:', event)
    }

    start() {
        if (this._keyframeInterval) {
            clearInterval(this._keyframeInterval)
            this._keyframeInterval = null
        }
        if (this._gamepadSyncTimeout) {
            clearTimeout(this._gamepadSyncTimeout)
            this._gamepadSyncTimeout = null
        }

        this._sendControlMessage({
            message: 'authorizationRequest',
            accessKey: '4BDB3609-C1F1-4195-9B37-FEFF45DA8B8E',
        })

        this._client._inputDriver.start()
        this._client._keyboardDriver.start()

        this.sendGamepadRemoved(0)

        if (this._client._config.input_coop) {
            this.sendGamepadRemoved(1)
        }

        this._gamepadSyncTimeout = setTimeout(() => {
            this.sendGamepadAdded(0)
            if (this._client._config.input_coop) {
                this.sendGamepadAdded(1)
            }
        }, 500)

        this._keyframeInterval = setInterval(() => {
            this.requestKeyframeRequest()
        }, 5 * 1000)
    }

    sendGamepadAdded(gamepadIndex) {
        this._sendControlMessage({
            message: 'gamepadChanged',
            gamepadIndex: gamepadIndex,
            wasAdded: true,
        })
    }

    sendGamepadRemoved(gamepadIndex) {
        this._sendControlMessage({
            message: 'gamepadChanged',
            gamepadIndex: gamepadIndex,
            wasAdded: false,
        })
    }
    
    onMessage(event) {
        console.log('xStreamingPlayer Channel/Control.ts - ['+this._channelName+'] onMessage:', event)

        const jsonMessage = JSON.parse(event.data)
        console.log('xStreamingPlayer Channel/Control.ts - Received json:', jsonMessage)
    }

    onClose(event) {
        super.onClose(event)
        // console.log('xStreamingPlayer Channel/Control.ts - ['+this._channelName+'] onClose:', event)

        this._client._inputDriver.stop()
        this._client._keyboardDriver.stop()

        if (this._keyframeInterval) {
            clearInterval(this._keyframeInterval)
            this._keyframeInterval = null
        }
        if (this._gamepadSyncTimeout) {
            clearTimeout(this._gamepadSyncTimeout)
            this._gamepadSyncTimeout = null
        }
        this.sendGamepadRemoved(0)
        if (this._client._config.input_coop) {
            this.sendGamepadRemoved(1)
        }
    }

    destroy() {
        if (this._keyframeInterval) {
            clearInterval(this._keyframeInterval)
            this._keyframeInterval = null
        }
        if (this._gamepadSyncTimeout) {
            clearTimeout(this._gamepadSyncTimeout)
            this._gamepadSyncTimeout = null
        }
        this.sendGamepadRemoved(0)
        if (this._client._config.input_coop) {
            this.sendGamepadRemoved(1)
        }
        super.destroy()
    }

    requestKeyframeRequest() {
        console.log('xStreamingPlayer Channel/Control.ts - ['+this._channelName+'] User requested Video KeyFrame')
        this._sendControlMessage({
            message: 'videoKeyframeRequested',
            ifrRequested: true,
        })
    }

    _sendControlMessage(data: any) {
        const channel = this.getClient().getChannel(this._channelName)
        if (!channel || channel.readyState !== 'open') {
            return
        }
        this.send(JSON.stringify(data))
    }
}
