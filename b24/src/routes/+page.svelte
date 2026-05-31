<script>
    import { onMount, derived } from 'svelte';
    import init, { smith_waterman, get_max_sequence_length } from 'smith_waterman_wasm';

    let seq1 = '';
    let seq2 = '';
    let matchScore = 2;
    let mismatchScore = -1;
    let gapPenalty = -2;
    let result = null;
    let error = null;
    let loading = false;
    let wasmReady = false;
    let maxLength = 2000;

    $: seq1TooLong = seq1.length > maxLength;
    $: seq2TooLong = seq2.length > maxLength;
    $: eitherSeqTooLong = seq1TooLong || seq2TooLong;
    $: warningMessage = eitherSeqTooLong 
        ? `Warning: Maximum sequence length is ${maxLength} characters. Please shorten your sequences.`
        : null;

    onMount(async () => {
        try {
            await init();
            wasmReady = true;
            try {
                maxLength = get_max_sequence_length();
            } catch {
                maxLength = 2000;
            }
        } catch (err) {
            error = 'Failed to load WASM module: ' + err.message;
        }
    });

    async function align() {
        if (!wasmReady) {
            error = 'WASM module is still loading, please wait...';
            return;
        }

        if (!seq1.trim() || !seq2.trim()) {
            error = 'Please enter both DNA sequences';
            return;
        }

        if (eitherSeqTooLong) {
            error = `Sequence too long. Maximum allowed length is ${maxLength} characters.`;
            return;
        }

        loading = true;
        error = null;
        result = null;

        try {
            result = await smith_waterman(
                seq1.toUpperCase().trim(),
                seq2.toUpperCase().trim(),
                matchScore,
                mismatchScore,
                gapPenalty
            );
        } catch (err) {
            error = 'Alignment failed: ' + (err.message || err);
        } finally {
            loading = false;
        }
    }

    function getAlignmentType(char1, char2) {
        if (char1 === char2 && char1 !== '-') {
            return 'match';
        } else if (char1 === '-' || char2 === '-') {
            return 'gap';
        } else {
            return 'mismatch';
        }
    }

    function formatAlignedSequence(seq, other) {
        let formatted = '';
        for (let i = 0; i < seq.length; i++) {
            const type = getAlignmentType(seq[i], other[i]);
            formatted += `<span class="align-${type}">${seq[i]}</span>`;
        }
        return formatted;
    }
</script>

<main class="container">
    <h1>DNA Sequence Alignment</h1>
    <h2>Smith-Waterman Local Alignment</h2>

    {#if !wasmReady}
        <div class="loading-wasm">
            Loading alignment engine...
        </div>
    {/if}

    {#if error}
        <div class="error">{error}</div>
    {/if}

    {#if warningMessage && !error}
        <div class="warning">{warningMessage}</div>
    {/if}

    <div class="input-section">
        <div class="input-group">
            <label for="seq1">DNA Sequence 1</label>
            <textarea
                id="seq1"
                bind:value={seq1}
                placeholder="Enter DNA sequence (A, T, C, G)"
                rows={4}
                disabled={loading || !wasmReady}
                class:textarea-error={seq1TooLong}
            />
            <small class="char-count" class:char-count-error={seq1TooLong}>
                {seq1.length} / {maxLength} characters
                {#if seq1TooLong}
                    <span class="error-text"> (Limit exceeded!)</span>
                {/if}
            </small>
        </div>

        <div class="input-group">
            <label for="seq2">DNA Sequence 2</label>
            <textarea
                id="seq2"
                bind:value={seq2}
                placeholder="Enter DNA sequence (A, T, C, G)"
                rows={4}
                disabled={loading || !wasmReady}
                class:textarea-error={seq2TooLong}
            />
            <small class="char-count" class:char-count-error={seq2TooLong}>
                {seq2.length} / {maxLength} characters
                {#if seq2TooLong}
                    <span class="error-text"> (Limit exceeded!)</span>
                {/if}
            </small>
        </div>
    </div>

    <div class="settings-section">
        <h3>Scoring Parameters</h3>
        <div class="settings-grid">
            <div class="setting">
                <label for="match">Match Score</label>
                <input
                    id="match"
                    type="number"
                    bind:value={matchScore}
                    disabled={loading || !wasmReady}
                />
            </div>
            <div class="setting">
                <label for="mismatch">Mismatch Score</label>
                <input
                    id="mismatch"
                    type="number"
                    bind:value={mismatchScore}
                    disabled={loading || !wasmReady}
                />
            </div>
            <div class="setting">
                <label for="gap">Gap Penalty</label>
                <input
                    id="gap"
                    type="number"
                    bind:value={gapPenalty}
                    disabled={loading || !wasmReady}
                />
            </div>
        </div>
    </div>

    <button
        on:click={align}
        disabled={loading || !wasmReady}
        class="align-button"
    >
        {#if loading}
            Aligning...
        {:else}
            Align Sequences
        {/if}
    </button>

    {#if result}
        <div class="result-section">
            <h3>Alignment Results</h3>
            <div class="score">
                <strong>Alignment Score:</strong> {result.score}
            </div>

            <div class="alignment-box">
                <h4>Aligned Sequences</h4>
                <div class="sequence-container">
                    <pre class="sequence" id="aligned-seq1">{@html formatAlignedSequence(result.aligned_seq1, result.aligned_seq2)}</pre>
                    <div class="match-line">
                        {#each result.aligned_seq1 as char, i}
                            {@const type = getAlignmentType(char, result.aligned_seq2[i])}
                            <span class="match-char-{type}">
                                {#if type === 'match'}|
                                {:else if type === 'gap'}
                                {:else}.
                                {/if}
                            </span>
                        {/each}
                    </div>
                    <pre class="sequence" id="aligned-seq2">{@html formatAlignedSequence(result.aligned_seq2, result.aligned_seq1)}</pre>
                </div>
            </div>

            <div class="legend">
                <h4>Legend</h4>
                <div class="legend-items">
                    <span class="legend-item">
                        <span class="legend-match">A</span> = Match (Green Background)
                    </span>
                    <span class="legend-item">
                        <span class="legend-mismatch">A</span> = Mismatch (Yellow Background)
                    </span>
                    <span class="legend-item">
                        <span class="legend-gap">-</span> = Gap (Red Background)
                    </span>
                </div>
            </div>
        </div>
    {/if}
</main>

<style>
    .container {
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    }

    h1 {
        color: #1e3a8a;
        font-size: 2rem;
        margin-bottom: 0.5rem;
        text-align: center;
    }

    h2 {
        color: #64748b;
        font-size: 1.2rem;
        margin-top: 0;
        text-align: center;
        font-weight: 400;
    }

    h3 {
        color: #1e293b;
        margin-bottom: 1rem;
        font-size: 1.25rem;
    }

    h4 {
        color: #475569;
        margin-bottom: 0.5rem;
        font-size: 1rem;
    }

    .loading-wasm {
        text-align: center;
        padding: 1rem;
        background-color: #fef3c7;
        border-radius: 8px;
        margin-bottom: 1.5rem;
        color: #92400e;
    }

    .error {
        background-color: #fef2f2;
        color: #991b1b;
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1.5rem;
        border-left: 4px solid #ef4444;
    }

    .warning {
        background-color: #fffbeb;
        color: #92400e;
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1.5rem;
        border-left: 4px solid #f59e0b;
    }

    .input-section {
        display: grid;
        gap: 1.5rem;
        margin-bottom: 1.5rem;
    }

    .input-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    label {
        font-weight: 600;
        color: #334155;
    }

    textarea {
        width: 100%;
        padding: 1rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-family: 'Courier New', monospace;
        font-size: 1rem;
        resize: vertical;
        box-sizing: border-box;
        transition: border-color 0.2s;
    }

    textarea:focus {
        outline: none;
        border-color: #3b82f6;
    }

    textarea:disabled {
        background-color: #f1f5f9;
        cursor: not-allowed;
    }

    .textarea-error {
        border-color: #ef4444;
    }

    .char-count {
        color: #94a3b8;
        font-size: 0.875rem;
        text-align: right;
    }

    .char-count-error {
        color: #ef4444;
        font-weight: 600;
    }

    .error-text {
        color: #ef4444;
        font-weight: 600;
    }

    .settings-section {
        background-color: #f8fafc;
        padding: 1.5rem;
        border-radius: 8px;
        margin-bottom: 1.5rem;
    }

    .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;
    }

    .setting {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .setting input {
        padding: 0.5rem;
        border: 2px solid #e2e8f0;
        border-radius: 6px;
        font-size: 1rem;
    }

    .setting input:disabled {
        background-color: #f1f5f9;
        cursor: not-allowed;
    }

    .align-button {
        width: 100%;
        padding: 1rem;
        background-color: #3b82f6;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s;
        margin-bottom: 2rem;
    }

    .align-button:hover:not(:disabled) {
        background-color: #2563eb;
    }

    .align-button:disabled {
        background-color: #94a3b8;
        cursor: not-allowed;
    }

    .result-section {
        background-color: #f0fdf4;
        padding: 1.5rem;
        border-radius: 8px;
        border: 1px solid #bbf7d0;
    }

    .score {
        font-size: 1.25rem;
        margin-bottom: 1.5rem;
        color: #166534;
    }

    .alignment-box {
        background-color: white;
        padding: 1rem;
        border-radius: 6px;
        margin-bottom: 1rem;
        border: 1px solid #d1fae5;
    }

    .sequence-container {
        font-family: 'Courier New', monospace;
        font-size: 1.25rem;
        line-height: 1.6;
    }

    .sequence {
        margin: 0;
        padding: 0.25rem 0;
        overflow-x: auto;
        white-space: pre;
    }

    .match-line {
        letter-spacing: 0.25rem;
        font-size: 1rem;
        padding: 0.25rem 0;
    }

    .legend {
        background-color: white;
        padding: 1rem;
        border-radius: 6px;
        border: 1px solid #d1fae5;
    }

    .legend-items {
        display: flex;
        flex-wrap: wrap;
        gap: 1.5rem;
    }

    .legend-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #475569;
    }

    .align-match {
        background-color: #dcfce7;
        color: #166534;
        font-weight: bold;
        padding: 0 2px;
        border-radius: 2px;
    }

    .align-mismatch {
        background-color: #fef9c3;
        color: #854d0e;
        font-weight: bold;
        padding: 0 2px;
        border-radius: 2px;
    }

    .align-gap {
        background-color: #fee2e2;
        color: #991b1b;
        font-weight: bold;
        padding: 0 2px;
        border-radius: 2px;
    }

    .match-char-match {
        color: #16a34a;
        font-weight: bold;
    }

    .match-char-mismatch {
        color: #ca8a04;
        font-weight: bold;
    }

    .match-char-gap {
        color: #9ca3af;
    }

    .legend-match {
        background-color: #dcfce7;
        color: #166534;
        font-weight: bold;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        min-width: 2rem;
        text-align: center;
    }

    .legend-mismatch {
        background-color: #fef9c3;
        color: #854d0e;
        font-weight: bold;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        min-width: 2rem;
        text-align: center;
    }

    .legend-gap {
        background-color: #fee2e2;
        color: #991b1b;
        font-weight: bold;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        min-width: 2rem;
        text-align: center;
    }
</style>
