import BaseChannel from './Base'

export default class DebugChannel extends BaseChannel {

    onOpen(event) {
        super.onOpen(event)

        // console.log('xStreamingPlayer Channel/Debug.ts - ['+this._channelName+'] onOpen:', event)
    }
    
    onMessage(event) {
        console.log('xStreamingPlayer Channel/Debug.ts - ['+this._channelName+'] onMessage:', event)
    }

    onClose(event) {
        super.onClose(event)
        // console.log('xStreamingPlayer Channel/Debug.ts - ['+this._channelName+'] onClose:', event)
    }
}