import xStreamingPlayer from '..'
import { InputFrame } from '../Channel/Input'
import Driver from './Driver'

const KEYCODE_KEY_N = 'n'

export default class GamepadDriver implements Driver {

    _application: xStreamingPlayer | null = null

    _shadowGamepad = {
        0: {
            A: 0,
            B: 0,
            X: 0,
            Y: 0,
            LeftShoulder: 0,
            RightShoulder: 0,
            LeftTrigger: 0,
            RightTrigger: 0,
            View: 0,
            Menu: 0,
            LeftThumb: 0,
            RightThumb: 0,
            DPadUp: 0,
            DPadDown: 0,
            DPadLeft: 0,
            DPadRight: 0,
            Nexus: 0,

            LeftThumbXAxis: 0.0,
            LeftThumbYAxis: 0.0,
            RightThumbXAxis: 0.0,
            RightThumbYAxis: 0.0,
        },
    }

    _gamepad_mapping = {
        'A': '0',
        'B': '1',
        'X': '2',
        'Y': '3',
        'DPadUp': '12',
        'DPadDown': '13',
        'DPadLeft': '14',
        'DPadRight': '15',
        'LeftShoulder': '4',
        'RightShoulder': '5',
        'LeftThumb': '10',
        'RightThumb': '11',
        'LeftTrigger': '6',
        'RightTrigger': '7',
        'Menu': '9',
        'View': '8',
        'Nexus': '16',
    }

    _gamepad_axes_mapping = {
        'LeftThumbXAxis': '0',
        'LeftThumbYAxis': '1',
        'RightThumbXAxis': '2',
        'RightThumbYAxis': '3',
    }

    _activeGamepads = { 0: false, 1: false, 2: false, 3: false}
    _activeGamepadsInterval

    _nexusOverrideN = false

    // constructor() {
    // }

    setApplication(application: xStreamingPlayer) {
        this._application = application
    }

    start() {
        this._activeGamepads = { 0: false, 1: false, 2: false, 3: false}
        
        // console.log('xStreamingPlayer Driver/Gamepad.ts - Start collecting events:', this._gamepads)
        this._activeGamepadsInterval = setInterval(() => {
            const gamepads = navigator.getGamepads()

            for (let gamepad = 0; gamepad < gamepads.length; gamepad++) {

                // Skip gamepad 0 as we always keep this one connected
                if(gamepad === 0) {return}

                // Check if the control channel is open
                if(this._application?.getChannelProcessor('control') === undefined) {return}

                if(gamepads[gamepad] === null && this._activeGamepads[gamepad] === true) {
                    this._application?.getChannelProcessor('control').sendGamepadRemoved(gamepad)
                    this._activeGamepads[gamepad] = false
                    return
                }

                if(gamepads[gamepad] !== null && this._activeGamepads[gamepad] === false) {
                    this._application?.getChannelProcessor('control').sendGamepadAdded(gamepad)
                    this._activeGamepads[gamepad] = true
                    return
                }
            }
        }, 500)

        window.addEventListener('keydown', this._downFunc)
        window.addEventListener('keyup', this._upFunc)
    }

    stop() {
        // console.log('xStreamingPlayer Driver/Gamepad.ts - Stop collecting events:', this._gamepads)
        clearInterval(this._activeGamepadsInterval)

        window.removeEventListener('keydown', this._downFunc)
        window.removeEventListener('keyup', this._upFunc)
    }

    _downFunc = (e: KeyboardEvent) => { this.onKeyChange(e, true) }
    _upFunc = (e: KeyboardEvent) => { this.onKeyChange(e, false) }

    onKeyChange(e: KeyboardEvent, down: boolean) {
        switch (e.key) {
            case KEYCODE_KEY_N:
                this._nexusOverrideN = down
                break
        }
    }

    pressButtonStart(index:number, button:string) {
        // console.log('pressButtonStart:', index, button)
        this._shadowGamepad[index][button] = 1
        this._application?.getChannelProcessor('input').queueGamepadState(this._shadowGamepad[index])
    }

    pressButtonEnd(index:number, button:string) {
        // console.log('pressButtonEnd:', index, button)
        this._shadowGamepad[index][button] = 0
        this._application?.getChannelProcessor('input').queueGamepadState(this._shadowGamepad[index])
    }

    // left stick move
    moveLeftStick(index: number, x: number, y: number) {
        this._shadowGamepad[index].LeftThumbXAxis = x
        this._shadowGamepad[index].LeftThumbYAxis = -y
        this._application?.getChannelProcessor('input').queueGamepadState(this._shadowGamepad[index])
    }

    // right stick move
    moveRightStick(index: number, x: number, y: number) {
        this._shadowGamepad[index].RightThumbXAxis = x
        this._shadowGamepad[index].RightThumbYAxis = -y
        this._application?.getChannelProcessor('input').queueGamepadState(this._shadowGamepad[index])
    }

    // Only ran when new gamepad driver is selected
    run(){
        const gpState = this.requestStates()

        if(gpState[0] !== undefined) {
            if(this._nexusOverrideN === true){
                gpState[0].Nexus = 1
            }
        }

        this._application?.getChannelProcessor('input')._inputFps.count()
        this._application?.getChannelProcessor('input').queueGamepadStates(gpState)

        // requestAnimationFrame(() => { this.run() })
        setTimeout(() => { this.run() }, 1000 / 60)
    }

    requestStates():Array<InputFrame> {
        const gamepads = navigator.getGamepads()
        // let foundActive = false
        const states:Array<InputFrame> = []
        for (let gamepad = 0; gamepad < gamepads.length; gamepad++) {
            const gamepadState = gamepads[gamepad]

            if (gamepadState !== null && gamepadState.connected) {
                const state = this.mapStateLabels(gamepadState.buttons, gamepadState.axes)
                state.GamepadIndex = gamepadState.index
                states.push(state)
            }
        }

        return states
    }

    normaliseAxis(value: number): number {
        if (this._application) {
            if(Math.abs(value) < this._application._gamepad_deadzone) {
                return 0
            }
    
            value = value - Math.sign(value) * this._application._gamepad_deadzone
            value /= (1.0 - this._application._gamepad_deadzone)
            
            return value
        } else {
            return value
        }
    }

    getDefaultFamepadFrame(){
        return {
            Nexus: 0,
            Menu: 0,
            View: 0,
            A: 0,
            B: 0,
            X: 0,
            Y: 0,
            DPadUp: 0,
            DPadDown: 0,
            DPadLeft: 0,
            DPadRight: 0,
            LeftShoulder: 0,
            RightShoulder: 0,
            LeftThumb: 0,
            RightThumb: 0,

            LeftThumbXAxis: 0,
            LeftThumbYAxis: 0,
            RightThumbXAxis: 0,
            RightThumbYAxis: 0,
            LeftTrigger: 0,
            RightTrigger: 0,
        }
    }

    mapStateLabels(buttons, axes) {
        const frame = this.getDefaultFamepadFrame() as InputFrame

        let maping = this._gamepad_mapping

        if (this._application && this._application._custom_gamepad_mapping) {
            maping = this._application._custom_gamepad_mapping
        }

        // Set buttons
        for(const button in maping) {
            frame[button] = buttons[maping[button]].value || 0
        }

        // Set axis
        for(const axis in this._gamepad_axes_mapping) {
            frame[axis] = this.normaliseAxis(axes[this._gamepad_axes_mapping[axis]])
        }
        // Start + Select Nexus menu workaround
        if(frame.View > 0 && frame.Menu > 0){
            frame.View = 0
            frame.Menu = 0

            frame.Nexus = 1
        }

        return frame
    }
}