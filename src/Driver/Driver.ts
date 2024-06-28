import xStreamingPlayer from '..'
import { InputFrame } from '../Channel/Input'

export default interface Driver { 
    setApplication(application: xStreamingPlayer): void; 
    start(): void;
    stop(): void;

    pressButtonStart(index: number, button: string): void;
    pressButtonEnd(index: number, button: string): void;

    requestStates(): Array<InputFrame>;
    mapStateLabels(buttons: Array<boolean>, axes:Array<any>): InputFrame;
} 