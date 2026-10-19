/** UTF-16 コード単位で切り詰める。サロゲートペアの途中では切らない */
export function truncateText(
	text: string,
	maxChars: number,
): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	const sliced = text.slice(0, maxChars);
	const last = sliced.charCodeAt(sliced.length - 1);
	const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
	return {
		text: isHighSurrogate ? sliced.slice(0, -1) : sliced,
		truncated: true,
	};
}
