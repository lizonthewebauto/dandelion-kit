// One shared guide for the person's AI. These choices are judged by eye, not measured.
export const RUBRICS = Object.freeze({
  fonts: [
    { name: 'Inter', feel: 'Plain, clear sans. A safe body font.' },
    { name: 'Fraunces', feel: 'Warm, soft serif. Rounded shapes.' },
    { name: 'Montserrat', feel: 'Clean sans with neat, even shapes.' },
    { name: 'Anton', feel: 'Tall, narrow, heavy headings.' },
    { name: 'Archivo Black', feel: 'Wide, heavy headings.' },
    { name: 'Instrument Serif', feel: 'Fine serif with thin and thick strokes.' },
    { name: 'IBM Plex Mono', feel: 'Even letter widths. Like code or typed notes.' },
    { name: 'Space Mono', feel: 'Even letter widths with a playful shape.' },
  ],
  caption_themes: [
    { id: 'karaoke-highlight', feel: 'A few words at once. The spoken word lights up.' },
    { id: 'karaoke-pill', feel: 'A few words at once. A round box marks the spoken word.' },
    { id: 'one-word-pop', feel: 'One large word at a time with a small swell.' },
    { id: 'bold-stroke', feel: 'Heavy words with a strong edge.' },
    { id: 'clean-minimal', feel: 'Plain, quiet lines with little extra ink.' },
    { id: 'editorial-serif', feel: 'Soft serif words for a calm feel.' },
    { id: 'box-caption', feel: 'Words in a solid box for clear reading.' },
    { id: 'mono-terminal', feel: 'Even letter widths, like typed notes.' },
  ],
  tokens: [
    { token: 'radius', values: ['sharp', 'soft', 'round'], feel: 'Square corners, a small curve, or a large curve.' },
    { token: 'heading_case', values: ['default', 'upper', 'lower'], feel: 'The font as it comes, all capitals, or all small letters.' },
    { token: 'background', values: ['flat', 'soft', 'dots'], feel: 'One color, a faint fade, or small quiet dots. Photo and accent pages keep their own fill.' },
    { token: 'margin', values: ['standard', 'wide', 'tight'], feel: 'The usual space, more space, or less space at the edges.' },
    { token: 'rule', values: ['thin', 'bold', 'none'], feel: 'A thin footer line, a thick line, or no line.' },
  ],
  looks: [
    { id: 'karaoke-clean', summary: 'Clear captions, steady cuts and light sound.' },
    { id: 'bold-value', summary: 'Heavy captions, tight cuts and strong pushes.' },
    { id: 'minimal-educator', summary: 'Plain captions, slow pushes and quiet sound.' },
    { id: 'editorial-luxe', summary: 'Serif captions, room to breathe and a cool grade.' },
    { id: 'storytime-energy', summary: 'One word captions, warm color and strong pushes.' },
  ],
});
