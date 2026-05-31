/// <reference types="@sveltejs/kit" />

declare module 'smith_waterman_wasm' {
    export class AlignmentResult {
        score: number;
        aligned_seq1: string;
        aligned_seq2: string;
    }

    export function smith_waterman(
        seq1: string,
        seq2: string,
        match_score: number,
        mismatch_score: number,
        gap_penalty: number
    ): Promise<AlignmentResult>;

    export function get_max_sequence_length(): number;

    export default function init(): Promise<void>;
}
