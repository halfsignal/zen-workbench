/**
 * A stateful session tied to a device target.
 *
 * Caches the device configuration, parser config, lexer config, and
 * built-in completions so they are not rebuilt on every API call.
 */
export class GpcSession {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GpcSessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_gpcsession_free(ptr, 0);
    }
    /**
     * Run semantic analysis and return summary data.
     * @param {string} source
     * @returns {WasmResponse<AnalyzeData>}
     */
    analyze(source) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_analyze(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Check GPC source code at the specified analysis depth.
     *
     * - `depth`: `"parse"` for parse-only, `"semantic"` for semantic analysis with declarations,
     *   `"full"` (default) for full compilation check.
     *
     * Only the semantic depth carries a payload. The other two answer with an
     * absent one and the diagnostics of that depth.
     * @param {string} source
     * @param {string} depth
     * @returns {WasmResponse<SemanticCheckData | undefined>}
     */
    check(source, depth) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(depth, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_check(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * Generate quick fix code actions from diagnostic markers.
     *
     * The action list is empty when nothing on offer matches the markers that
     * were sent in, which is a successful answer and not a missing one.
     * @param {string} source
     * @param {string} markers_json
     * @returns {WasmResponse<CodeActionsData>}
     */
    code_actions(source, markers_json) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(markers_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_code_actions(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * Build code lens annotations for declarations.
     *
     * The payload is absent when the document declares nothing to annotate.
     * @param {string} source
     * @returns {WasmResponse<CodeLensData | undefined>}
     */
    code_lens(source) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_code_lens(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Compile GPC source code.
     *
     * Answers with the bytecode as hex, the variable and constant tables, the
     * per-combo statistics, any internal compiler issue, and the diagnostics.
     * @param {string} source
     * @param {string | null} [options_json]
     * @returns {WasmResponse<CompileData>}
     */
    compile(source, options_json) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(options_json) ? 0 : passStringToWasm0(options_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_compile(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * Compile and return all analytics data in a single response.
     * @param {string} source
     * @returns {WasmResponse<AnalyticsData>}
     */
    compile_analytics(source) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_compile_analytics(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Return context-aware completion items for the given cursor position.
     *
     * Line and column are 1-based (Monaco convention). The item list is always
     * present and is empty where the cursor offers nothing, so there is no
     * absent-payload case to check.
     * @param {string} source
     * @param {number} line
     * @param {number} column
     * @returns {WasmResponse<CompletionData>}
     */
    completions(source, line, column) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_completions(this.__wbg_ptr, ptr0, len0, line, column);
        return takeObject(ret);
    }
    /**
     * Return the definition location for the symbol at the given position.
     *
     * Line and column are 1-based (Monaco convention). The payload is absent
     * for a built-in symbol, for an unknown word, and when the cursor is
     * already at the definition site.
     * @param {string} source
     * @param {number} line
     * @param {number} column
     * @returns {WasmResponse<DefinitionData | undefined>}
     */
    definition(source, line, column) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_definition(this.__wbg_ptr, ptr0, len0, line, column);
        return takeObject(ret);
    }
    /**
     * Return the built-in names and syntax features of the device this session
     * targets.
     * @returns {WasmResponse<DeviceConfigData>}
     */
    device_config() {
        const ret = wasm.gpcsession_device_config(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Highlight all occurrences of the symbol at the cursor.
     *
     * The payload is absent when there is nothing to highlight.
     * @param {string} source
     * @param {number} line
     * @param {number} column
     * @returns {WasmResponse<DocumentHighlightData | undefined>}
     */
    document_highlight(source, line, column) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_document_highlight(this.__wbg_ptr, ptr0, len0, line, column);
        return takeObject(ret);
    }
    /**
     * Compute document symbols for the outline panel.
     * @param {string} source
     * @returns {WasmResponse<DocumentSymbolsData>}
     */
    document_symbols(source) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_document_symbols(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Generate the refactor actions on offer for a selection.
     *
     * Two of them: folding a static expression to its value, and rewriting a
     * number literal in another radix. The selection is snapped outward to
     * whole token boundaries first, so a half-selected token behaves as if it
     * had been selected whole.
     *
     * Line and column are 1-based (Monaco convention). The payload is absent
     * when nothing is on offer, which includes a selection inside a string or
     * a comment and one over an expression that does not fold.
     * @param {string} source
     * @param {number} start_line
     * @param {number} start_column
     * @param {number} end_line
     * @param {number} end_column
     * @returns {WasmResponse<ExpressionActionsData | undefined>}
     */
    expression_actions(source, start_line, start_column, end_line, end_column) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_expression_actions(this.__wbg_ptr, ptr0, len0, start_line, start_column, end_line, end_column);
        return takeObject(ret);
    }
    /**
     * Find all references to the symbol at the cursor.
     *
     * The payload is absent when nothing matched.
     * @param {string} source
     * @param {number} line
     * @param {number} column
     * @returns {WasmResponse<ReferencesData | undefined>}
     */
    find_references(source, line, column) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_find_references(this.__wbg_ptr, ptr0, len0, line, column);
        return takeObject(ret);
    }
    /**
     * Compute folding ranges for braces and block comments.
     * @param {string} source
     * @returns {WasmResponse<FoldingData>}
     */
    folding_ranges(source) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_folding_ranges(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Format GPC source code.
     *
     * - `config_json`: optional JSON config with `indentStyle` and `lineEnding`.
     * @param {string} source
     * @param {string | null} [config_json]
     * @returns {WasmResponse<FormatData>}
     */
    format(source, config_json) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(config_json) ? 0 : passStringToWasm0(config_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_format(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * Format after typing a trigger character.
     *
     * The payload is absent when the line already carries the right
     * indentation.
     * @param {string} source
     * @param {number} line
     * @param {number} column
     * @param {string} trigger_char
     * @param {string | null} [config_json]
     * @returns {WasmResponse<OnTypeFormatData | undefined>}
     */
    format_on_type(source, line, column, trigger_char, config_json) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(trigger_char, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(config_json) ? 0 : passStringToWasm0(config_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_format_on_type(this.__wbg_ptr, ptr0, len0, line, column, ptr1, len1, ptr2, len2);
        return takeObject(ret);
    }
    /**
     * Format the source within a given range.
     *
     * The payload is absent when the selection already matches what the
     * formatter would produce, so no no-op edit is ever applied.
     * @param {string} source
     * @param {number} start_line
     * @param {number} start_column
     * @param {number} end_line
     * @param {number} end_column
     * @param {string | null} [config_json]
     * @returns {WasmResponse<RangeFormatData | undefined>}
     */
    format_range(source, start_line, start_column, end_line, end_column, config_json) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(config_json) ? 0 : passStringToWasm0(config_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_format_range(this.__wbg_ptr, ptr0, len0, start_line, start_column, end_line, end_column, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * Explicitly free session resources.
     *
     * Takes ownership and drops -- provides explicit JS-side cleanup.
     */
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.gpcsession_free(ptr);
    }
    /**
     * Return hover information for the token at the given position.
     *
     * Line and column are 1-based (Monaco convention). The payload is absent
     * when there is nothing to show, which is the normal answer for a cursor
     * over whitespace, a comment or an unknown word.
     * @param {string} source
     * @param {number} line
     * @param {number} column
     * @returns {WasmResponse<HoverData | undefined>}
     */
    hover(source, line, column) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_hover(this.__wbg_ptr, ptr0, len0, line, column);
        return takeObject(ret);
    }
    /**
     * Build inlay hints for the visible range.
     *
     * The payload is absent when the range holds nothing to annotate.
     * @param {string} source
     * @param {number} start_line
     * @param {number} start_column
     * @param {number} end_line
     * @param {number} end_column
     * @returns {WasmResponse<InlayHintsData | undefined>}
     */
    inlay_hints(source, start_line, start_column, end_line, end_column) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_inlay_hints(this.__wbg_ptr, ptr0, len0, start_line, start_column, end_line, end_column);
        return takeObject(ret);
    }
    /**
     * Create a new session for the given device target.
     *
     * - `target`: device target string (e.g. "zen32", "zen", "cmp", "xaim").
     * - `custom_config_json`: optional JSON string for a custom device config.
     *
     * # Throws
     *
     * Rejects with an `Error` (JS side) when the built-in device config
     * for the resolved target fails to load. This is a defensive guard
     * against corrupted embedded configs; normal targets never throw.
     * An unrecognized `target` silently falls back to the default target.
     * A malformed or invalid `custom_config_json` (fails to parse, or fails
     * `validate_config`) rejects with an `Error` — a provided override is a
     * caller error if bad, never a silent downgrade. Only an ABSENT override
     * falls through to the module-default, then the built-in config.
     * @param {string} target
     * @param {string | null} [custom_config_json]
     */
    constructor(target, custom_config_json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(target, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(custom_config_json) ? 0 : passStringToWasm0(custom_config_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            wasm.gpcsession_new(retptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            GpcSessionFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Run parse + analyze (no compile) and return lightweight analytics data.
     *
     * Returns outline, call graph, function usage, combo usage, and diagnostics.
     * Suitable for updating panels on keystroke without waiting for full compilation.
     * @param {string} source
     * @returns {WasmResponse<ParseAnalyticsData>}
     */
    parse_analytics(source) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_parse_analytics(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Prune dead code from GPC source.
     *
     * Removes unused functions, dead combos, and unreferenced const arrays.
     * Answers with the pruned source and the lists of what was removed.
     * - `config_json`: optional JSON config with `indentStyle` and `lineEnding`.
     * @param {string} source
     * @param {string | null} [config_json]
     * @returns {WasmResponse<PruneData>}
     */
    prune(source, config_json) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(config_json) ? 0 : passStringToWasm0(config_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_prune(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * Rename a user-defined symbol at the given position.
     *
     * Line and column are 1-based (Monaco convention). The payload is absent
     * when there is no renamable symbol at the cursor, which includes a
     * built-in name and a position over whitespace or a comment.
     * @param {string} source
     * @param {number} line
     * @param {number} column
     * @param {string} new_name
     * @returns {WasmResponse<RenameData | undefined>}
     */
    rename(source, line, column, new_name) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(new_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_rename(this.__wbg_ptr, ptr0, len0, line, column, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * Resolve the rename location at the given cursor position.
     *
     * Always answers with a payload, in one of two disjoint shapes: the span
     * and current text when the symbol can be renamed, or a rejection reason
     * when it cannot.
     * @param {string} source
     * @param {number} line
     * @param {number} column
     * @returns {WasmResponse<RenameLocation>}
     */
    rename_location(source, line, column) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_rename_location(this.__wbg_ptr, ptr0, len0, line, column);
        return takeObject(ret);
    }
    /**
     * Build nested selection ranges for smart expand/shrink.
     *
     * The payload is absent when no position was given or the request could
     * not be read.
     * @param {string} source
     * @param {string} positions_json
     * @returns {WasmResponse<SelectionRangeData | undefined>}
     */
    selection_ranges(source, positions_json) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(positions_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_selection_ranges(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * Return signature help for the function call at the given position.
     *
     * Line and column are 1-based (Monaco convention). The payload is absent
     * when the cursor is not inside a function call.
     * @param {string} source
     * @param {number} line
     * @param {number} column
     * @returns {WasmResponse<SignatureHelpData | undefined>}
     */
    signature_help(source, line, column) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_signature_help(this.__wbg_ptr, ptr0, len0, line, column);
        return takeObject(ret);
    }
    /**
     * Tokenize GPC source code.
     *
     * - `format`: `"full"` for complete token data, `"monaco"` for line-based Monaco tokens.
     * @param {string} source
     * @param {string} format
     * @returns {WasmResponse<TokenizePayload>}
     */
    tokenize(source, format) {
        const ptr0 = passStringToWasm0(source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(format, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.gpcsession_tokenize(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
}
if (Symbol.dispose) GpcSession.prototype[Symbol.dispose] = GpcSession.prototype.free;

/**
 * Initialize the module.
 *
 * If a custom device configuration document is provided, it is parsed once and
 * stored as the module-level default, used by every session created afterwards
 * that does not provide its own override. Calling this with no argument clears
 * any previously stored default.
 *
 * A document that fails to parse answers with the unsuccessful arm carrying the
 * parse message, and clears the stored default rather than leaving the module
 * half-configured. It never panics.
 * @param {string | null} [custom_config_json]
 * @returns {WasmResponse<null>}
 */
export function init(custom_config_json) {
    var ptr0 = isLikeNone(custom_config_json) ? 0 : passStringToWasm0(custom_config_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.init(ptr0, len0);
    return takeObject(ret);
}

/**
 * Return the name of every supported device target, lowercased.
 * @returns {WasmResponse<string[]>}
 */
export function list_targets() {
    const ret = wasm.list_targets();
    return takeObject(ret);
}

/**
 * Minimum CronusZen firmware the emitted bytecode requires, as a raw semver
 * string.
 *
 * Static and library-wide. Presentation and the cross-library floor comparison
 * belong to the consuming application; this supplies only the raw value.
 * Available on every variant, since it is a static string and costs nothing to
 * expose everywhere.
 * @returns {string}
 */
export function minimum_firmware_version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.minimum_firmware_version(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Runs once at module instantiation, before any export is called.
 *
 * Installs the panic hook so a panic writes its message and stack trace to
 * the JavaScript console, and is recorded for `take_last_panic`, before the
 * module traps. Without it a trap reads only `unreachable`.
 */
export function start() {
    wasm.start();
}

/**
 * Take the most recent panic the panic hook recorded, as
 * `<message> at <file:line:column>`, or nothing when there is none.
 *
 * Used by the JS workers after a wasm trap: when a panic traps the module,
 * the hook has already recorded it, and this names the panic in the trap
 * report. Taking it means the next report cannot repeat it. It is called on a
 * module that has just trapped, so the JS side treats any failure here as
 * "no panic text" and still reports the trap.
 * @returns {string | undefined}
 */
export function take_last_panic() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.take_last_panic(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v1;
        if (r0 !== 0) {
            v1 = getStringFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Return version and build information about this module.
 * @returns {WasmResponse<VersionInfo>}
 */
export function version() {
    const ret = wasm.version();
    return takeObject(ret);
}

/**
 * The size of the module's linear memory, in 64 KiB wasm pages.
 *
 * Used by the JS workers to annotate a wasm trap with the module's memory
 * footprint. Neither wasm-pack layout puts the memory on the module namespace
 * (the bundler glue does not export it at all), so asking the module is the
 * only reading that works in every package. It must keep working after a
 * trap, which is why it is a single `memory.size` instruction: no guard, no
 * allocation, no borrow of any session.
 * @returns {number}
 */
export function wasm_memory_pages() {
    const ret = wasm.wasm_memory_pages();
    return ret >>> 0;
}
export function __wbg_Error_92b29b0548f8b746(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
}
export function __wbg_String_8564e559799eccda(arg0, arg1) {
    const ret = String(getObject(arg1));
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_is_function_1ff95bcc5517c252(arg0) {
    const ret = typeof(getObject(arg0)) === 'function';
    return ret;
}
export function __wbg___wbindgen_is_null_ea9085d691f535d3(arg0) {
    const ret = getObject(arg0) === null;
    return ret;
}
export function __wbg___wbindgen_is_string_ea5e6cc2e4141dfe(arg0) {
    const ret = typeof(getObject(arg0)) === 'string';
    return ret;
}
export function __wbg___wbindgen_is_undefined_c05833b95a3cf397(arg0) {
    const ret = getObject(arg0) === undefined;
    return ret;
}
export function __wbg___wbindgen_string_get_b0ca35b86a603356(arg0, arg1) {
    const obj = getObject(arg1);
    const ret = typeof(obj) === 'string' ? obj : undefined;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_throw_344f42d3211c4765(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbg_apply_23dd4d2439189415() { return handleError(function (arg0, arg1, arg2) {
    const ret = Reflect.apply(getObject(arg0), getObject(arg1), getObject(arg2));
    return addHeapObject(ret);
}, arguments); }
export function __wbg_error_4b0b4ad2da08b21b(arg0, arg1) {
    console.error(getStringFromWasm0(arg0, arg1));
}
export function __wbg_error_a6fa202b58aa1cd3(arg0, arg1) {
    let deferred0_0;
    let deferred0_1;
    try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.error(getStringFromWasm0(arg0, arg1));
    } finally {
        wasm.__wbindgen_export4(deferred0_0, deferred0_1, 1);
    }
}
export function __wbg_get_78f252d074a84d0b() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(getObject(arg0), getObject(arg1));
    return addHeapObject(ret);
}, arguments); }
export function __wbg_new_227d7c05414eb861() {
    const ret = new Error();
    return addHeapObject(ret);
}
export function __wbg_new_32b398fb48b6d94a() {
    const ret = new Array();
    return addHeapObject(ret);
}
export function __wbg_new_7796ffc7ed656783() {
    const ret = new Map();
    return addHeapObject(ret);
}
export function __wbg_new_da52cf8fe3429cb2() {
    const ret = new Object();
    return addHeapObject(ret);
}
export function __wbg_set_575dd786d51585f8(arg0, arg1, arg2) {
    const ret = getObject(arg0).set(getObject(arg1), getObject(arg2));
    return addHeapObject(ret);
}
export function __wbg_set_6be42768c690e380(arg0, arg1, arg2) {
    getObject(arg0)[takeObject(arg1)] = takeObject(arg2);
}
export function __wbg_set_8a16b38e4805b298(arg0, arg1, arg2) {
    getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
}
export function __wbg_stack_3b0d974bbf31e44f(arg0, arg1) {
    const ret = getObject(arg1).stack;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_static_accessor_GLOBAL_4ef717fb391d88b7() {
    const ret = typeof global === 'undefined' ? null : global;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
}
export function __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4() {
    const ret = typeof globalThis === 'undefined' ? null : globalThis;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
}
export function __wbg_static_accessor_SELF_146583524fe1469b() {
    const ret = typeof self === 'undefined' ? null : self;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
}
export function __wbg_static_accessor_WINDOW_f2829a2234d7819e() {
    const ret = typeof window === 'undefined' ? null : window;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
}
export function __wbg_warn_9e49958c44c6bd8c(arg0, arg1) {
    console.warn(getStringFromWasm0(arg0, arg1));
}
export function __wbindgen_cast_0000000000000001(arg0) {
    // Cast intrinsic for `F64 -> Externref`.
    const ret = arg0;
    return addHeapObject(ret);
}
export function __wbindgen_cast_0000000000000002(arg0) {
    // Cast intrinsic for `I64 -> Externref`.
    const ret = arg0;
    return addHeapObject(ret);
}
export function __wbindgen_cast_0000000000000003(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return addHeapObject(ret);
}
export function __wbindgen_object_clone_ref(arg0) {
    const ret = getObject(arg0);
    return addHeapObject(ret);
}
export function __wbindgen_object_drop_ref(arg0) {
    takeObject(arg0);
}
const GpcSessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_gpcsession_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export3(addHeapObject(e));
    }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
