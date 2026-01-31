import { parseTextTemplate } from "../../../utils/parseTextTemplate.js";
import { removeUndefinedFields } from "../../../utils/removeNullFields.js";
export function templateSegmentOptionsToChatWrapperSettings(templateOptions) {
    if (templateOptions == null)
        return {};
    function getThoughtSegmentOptions() {
        if (templateOptions?.thoughtTemplate == null)
            return undefined;
        const parsedThoughtTemplate = parseTextTemplate(templateOptions.thoughtTemplate, [{
                text: "{{content}}",
                key: "content"
            }]);
        const prefix = parsedThoughtTemplate.content.prefix;
        if (prefix.length === 0)
            throw new Error("Thought template must have text before \"{{content}}\"");
        return removeUndefinedFields({
            prefix,
            suffix: parsedThoughtTemplate.content.suffix || undefined,
            reopenAfterFunctionCalls: templateOptions.reopenThoughtAfterFunctionCalls
        });
    }
    return removeUndefinedFields({
        closeAllSegments: templateOptions.closeAllSegmentsTemplate || undefined,
        reiterateStackAfterFunctionCalls: templateOptions.reiterateStackAfterFunctionCalls,
        thought: getThoughtSegmentOptions()
    });
}
//# sourceMappingURL=templateSegmentOptionsToChatWrapperSettings.js.map