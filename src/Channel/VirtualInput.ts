import BaseChannel from './Base'

import InputPacket from './Input/Packet'

export interface InputFrame {
    GamepadIndex: number;
    Nexus: number;
    Menu: number;
    View: number;
    A: number;
    B: number;
    X: number;
    Y: number;
    DPadUp: number;
    DPadDown: number;
    DPadLeft: number;
    DPadRight: number;
    LeftShoulder: number;
    RightShoulder: number;
    LeftThumb: number;
    RightThumb: number;

    LeftThumbXAxis: number;
    LeftThumbYAxis: number;
    RightThumbXAxis: number;
    RightThumbYAxis: number;
    LeftTrigger: number;
    RightTrigger: number;
}

export default class InputChannel extends BaseChannel {

    _inputSequenceNum = 0

    _reportTypes = {
        None: 0,
        Metadata: 1,
        Gamepad: 2,
        Pointer: 4,
        ClientMetadata: 8,
        ServerMetadata: 16,
        Mouse: 32,
        Keyboard: 64,
        Vibration: 128,
        Sendor: 256,
    }

    _frameMetadataQueue:Array<any> = []

    _gamepadFrames:Array<InputFrame> = []
    _inputInterval

    _keyboardEvents:Array<any> = []

    _rumbleInterval = {0: undefined, 1: undefined, 2: undefined, 3: undefined }
    _rumbleEnabled = true
    _adhocState

    constructor(channelName, client) {
        super(channelName, client)
    }

    onOpen(event) {
        super.onOpen(event)
    }

    start(){
        console.log('virtual input start')
        const Packet = new InputPacket(this._inputSequenceNum)
        Packet.setMetadata(2)

        this.send(Packet.toBuffer())

        if(this._client._config.input_legacykeyboard === false){
            this.getClient()._inputDriver.run()
        }
        
        this._inputInterval = setInterval(() => {
            const metadataQueue = []
            const gamepadQueue = this.getGamepadQueue()
            const pointerQueue = []
            const mouseQueue = []
            const keyboardQueue = []

            if(gamepadQueue.length !== 0){

                this._inputSequenceNum++
                const packet = new InputPacket(this._inputSequenceNum)
                packet.setData(metadataQueue, gamepadQueue, pointerQueue, mouseQueue, keyboardQueue)
                
                console.log('virtual input send packet:', packet)
                this.send(packet.toBuffer())
            }
        }, 16) // 16 ms = 1 frame (1000/60)
    }

    mergeState(gpState:InputFrame, kbState:InputFrame, adHoc:InputFrame):InputFrame{
        return {
            GamepadIndex: gpState?.GamepadIndex ?? kbState.GamepadIndex,
            A: Math.max(gpState?.A ?? 0, kbState.A, adHoc?.A ?? 0),
            B: Math.max(gpState?.B ?? 0, kbState.B, adHoc?.B ?? 0),
            X: Math.max(gpState?.X ?? 0, kbState.X, adHoc?.X ?? 0),
            Y: Math.max(gpState?.Y ?? 0, kbState.Y, adHoc?.Y ?? 0),
            LeftShoulder: Math.max(gpState?.LeftShoulder ?? 0, kbState.LeftShoulder, adHoc?.LeftShoulder ?? 0),
            RightShoulder: Math.max(gpState?.RightShoulder ?? 0, kbState.RightShoulder, adHoc?.RightShoulder ?? 0),
            LeftTrigger: Math.max(gpState?.LeftTrigger ?? 0, kbState.LeftTrigger, adHoc?.LeftTrigger ?? 0),
            RightTrigger: Math.max(gpState?.RightTrigger ?? 0, kbState.RightTrigger, adHoc?.RightTrigger ?? 0),
            View: Math.max(gpState?.View ?? 0, kbState.View, adHoc?.View ?? 0),
            Menu: Math.max(gpState?.Menu ?? 0, kbState.Menu, adHoc?.Menu ?? 0),
            LeftThumb: Math.max(gpState?.LeftThumb ?? 0, kbState.LeftThumb, adHoc?.LeftThumb ?? 0),
            RightThumb: Math.max(gpState?.RightThumb ?? 0, kbState.RightThumb, adHoc?.RightThumb ?? 0),
            DPadUp: Math.max(gpState?.DPadUp ?? 0, kbState.DPadUp, adHoc?.DPadUp ?? 0),
            DPadDown: Math.max(gpState?.DPadDown ?? 0, kbState.DPadDown, adHoc?.DPadDown ?? 0),
            DPadLeft: Math.max(gpState?.DPadLeft ?? 0, kbState.DPadLeft, adHoc?.DPadLeft ?? 0),
            DPadRight: Math.max(gpState?.DPadRight ?? 0, kbState.DPadRight, adHoc?.DPadRight ?? 0),
            Nexus: Math.max(gpState?.Nexus ?? 0, kbState.Nexus, adHoc?.Nexus ?? 0),
            LeftThumbXAxis: this.mergeAxix(gpState?.LeftThumbXAxis ?? 0, kbState.LeftThumbXAxis),
            LeftThumbYAxis: this.mergeAxix(gpState?.LeftThumbYAxis ?? 0, kbState.LeftThumbYAxis),
            RightThumbXAxis: this.mergeAxix(gpState?.RightThumbXAxis ?? 0, kbState.RightThumbXAxis),
            RightThumbYAxis: this.mergeAxix(gpState?.RightThumbYAxis ?? 0, kbState.RightThumbYAxis),
        } as InputFrame
    }
    
    mergeAxix(axis1: number, axis2: number){
        if(Math.abs(axis1) > Math.abs(axis2)){
            return axis1
        }else{
            return axis2
        }
    }

    onClose(event) {
        clearInterval(this._inputInterval)

        super.onClose(event)
        // console.log('xStreamingPlayer Channel/Input.ts - ['+this._channelName+'] onClose:', event)
    }

    getGamepadQueue(size=30) {
        return this._gamepadFrames.splice(0, (size-1))
    }

    getGamepadQueueLength() {
        return this._gamepadFrames.length
    }

    queueGamepadState(input:InputFrame) {
        if(input !== null) {return this._gamepadFrames.push(input)}
    }

    queueGamepadStates(inputs:Array<InputFrame>) {
        for(const input in inputs){
            this.queueGamepadState(inputs[input])
        }
    }

    pressButtonStart(index:number, button:string){
        this._client._inputDriver.pressButtonStart(index, button)

        // close hard input
        this.getClient().getChannelProcessor('input').destroy()
    }

    pressButtonEnd(index:number, button:string){
        this._client._inputDriver.pressButtonEnd(index, button)
        setTimeout(() => {
          this.getClient().getChannelProcessor('input').start()
        }, 16)
    }

    moveLeftStick(index: number, x: number, y: number) {
        this._client._inputDriver.moveLeftStick(index, x, y)
    }

    moveRightStick(index: number, x: number, y: number) {
        this._client._inputDriver.moveRightStick(index, x, y)
    }

    destroy() {
        
        clearInterval(this._inputInterval)

        // FIX Android crash due of gamepad polling
        for (const key in this._rumbleInterval) {
            if (this._rumbleInterval[key]) {
                clearInterval(this._rumbleInterval[0])
            }
        }

        super.destroy()
    }

    addProcessedFrame(frame) {
        frame.frameRenderedTimeMs = performance.now()
        this._frameMetadataQueue.push(frame)
    }
}