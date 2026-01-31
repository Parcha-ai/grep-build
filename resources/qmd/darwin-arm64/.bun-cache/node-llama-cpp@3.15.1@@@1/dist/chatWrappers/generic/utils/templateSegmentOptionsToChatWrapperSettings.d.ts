import { ChatWrapperSettings } from "../../../types.js";
export declare function templateSegmentOptionsToChatWrapperSettings(templateOptions?: TemplateChatWrapperSegmentsOptions): ChatWrapperSettings["segments"];
export type TemplateChatWrapperSegmentsOptions = {
    /** Template for a thought segment */
    thoughtTemplate?: `${string}{{content}}${string}`;
    /**
     * Automatically reopen a thought segment after function calls.
     *
     * Useful for aligning the output of models that assume that a thought segment is already open after function calls.
     *
     * Defaults to `false`.
     */
    reopenThoughtAfterFunctionCalls?: boolean;
    /** Consider all segments to be closed when this text is detected */
    closeAllSegmentsTemplate?: string;
    /**
     * After function calls, reiterate the stack of the active segments to remind the model of the context.
     *
     * Defaults to `false`.
     */
    reiterateStackAfterFunctionCalls?: boolean;
};
