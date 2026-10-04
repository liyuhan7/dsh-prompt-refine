// 本文件由 npm run build 自动生成，请修改 client.js 或 highlight-core.js 后重新构建。
/* jsdiff 9.0.0 — BSD-3-Clause
BSD 3-Clause License

Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
(() => {
  const diffLibrary = (() => {
    const module = { exports: {} }
    const exports = module.exports;
(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.Diff = {}));
})(this, (function (exports) { 'use strict';

    class Diff {
        diff(oldStr, newStr, 
        // Type below is not accurate/complete - see above for full possibilities - but it compiles
        options = {}) {
            let callback;
            if (typeof options === 'function') {
                callback = options;
                options = {};
            }
            else if ('callback' in options) {
                callback = options.callback;
            }
            // Allow subclasses to massage the input prior to running
            const oldString = this.castInput(oldStr, options);
            const newString = this.castInput(newStr, options);
            const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
            const newTokens = this.removeEmpty(this.tokenize(newString, options));
            return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
        }
        diffWithOptionsObj(oldTokens, newTokens, options, callback) {
            var _a;
            const done = (value) => {
                value = this.postProcess(value, options);
                if (callback) {
                    setTimeout(function () { callback(value); }, 0);
                    return undefined;
                }
                else {
                    return value;
                }
            };
            const newLen = newTokens.length, oldLen = oldTokens.length;
            let editLength = 1;
            let maxEditLength = newLen + oldLen;
            if (options.maxEditLength != null) {
                maxEditLength = Math.min(maxEditLength, options.maxEditLength);
            }
            const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
            const abortAfterTimestamp = Date.now() + maxExecutionTime;
            const bestPath = [{ oldPos: -1, lastComponent: undefined }];
            // Seed editLength = 0, i.e. the content starts with the same values
            let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
            if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
                // Identity per the equality and tokenizer
                return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
            }
            // Once we hit the right edge of the edit graph on some diagonal k, we can
            // definitely reach the end of the edit graph in no more than k edits, so
            // there's no point in considering any moves to diagonal k+1 any more (from
            // which we're guaranteed to need at least k+1 more edits).
            // Similarly, once we've reached the bottom of the edit graph, there's no
            // point considering moves to lower diagonals.
            // We record this fact by setting minDiagonalToConsider and
            // maxDiagonalToConsider to some finite value once we've hit the edge of
            // the edit graph.
            // This optimization is not faithful to the original algorithm presented in
            // Myers's paper, which instead pointlessly extends D-paths off the end of
            // the edit graph - see page 7 of Myers's paper which notes this point
            // explicitly and illustrates it with a diagram. This has major performance
            // implications for some common scenarios. For instance, to compute a diff
            // where the new text simply appends d characters on the end of the
            // original text of length n, the true Myers algorithm will take O(n+d^2)
            // time while this optimization needs only O(n+d) time.
            let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
            // Main worker method. checks all permutations of a given edit length for acceptance.
            const execEditLength = () => {
                for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
                    let basePath;
                    const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
                    if (removePath) {
                        // No one else is going to attempt to use this value, clear it
                        // @ts-expect-error - perf optimisation. This type-violating value will never be read.
                        bestPath[diagonalPath - 1] = undefined;
                    }
                    let canAdd = false;
                    if (addPath) {
                        // what newPos will be after we do an insertion:
                        const addPathNewPos = addPath.oldPos - diagonalPath;
                        canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
                    }
                    const canRemove = removePath && removePath.oldPos + 1 < oldLen;
                    if (!canAdd && !canRemove) {
                        // If this path is a terminal then prune
                        // @ts-expect-error - perf optimisation. This type-violating value will never be read.
                        bestPath[diagonalPath] = undefined;
                        continue;
                    }
                    // Select the diagonal that we want to branch from. We select the prior
                    // path whose position in the old string is the farthest from the origin
                    // and does not pass the bounds of the diff graph
                    if (!canRemove || (canAdd && removePath.oldPos < addPath.oldPos)) {
                        basePath = this.addToPath(addPath, true, false, 0, options);
                    }
                    else {
                        basePath = this.addToPath(removePath, false, true, 1, options);
                    }
                    newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
                    if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
                        // If we have hit the end of both strings, then we are done
                        return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
                    }
                    else {
                        bestPath[diagonalPath] = basePath;
                        if (basePath.oldPos + 1 >= oldLen) {
                            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
                        }
                        if (newPos + 1 >= newLen) {
                            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
                        }
                    }
                }
                editLength++;
            };
            // Performs the length of edit iteration. Is a bit fugly as this has to support the
            // sync and async mode which is never fun. Loops over execEditLength until a value
            // is produced, or until the edit length exceeds options.maxEditLength (if given),
            // in which case it will return undefined.
            if (callback) {
                (function exec() {
                    setTimeout(function () {
                        if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
                            return callback(undefined);
                        }
                        if (!execEditLength()) {
                            exec();
                        }
                    }, 0);
                }());
            }
            else {
                while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
                    const ret = execEditLength();
                    if (ret) {
                        return ret;
                    }
                }
            }
        }
        addToPath(path, added, removed, oldPosInc, options) {
            const last = path.lastComponent;
            if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
                return {
                    oldPos: path.oldPos + oldPosInc,
                    lastComponent: { count: last.count + 1, added: added, removed: removed, previousComponent: last.previousComponent }
                };
            }
            else {
                return {
                    oldPos: path.oldPos + oldPosInc,
                    lastComponent: { count: 1, added: added, removed: removed, previousComponent: last }
                };
            }
        }
        extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
            const newLen = newTokens.length, oldLen = oldTokens.length;
            let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
            while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
                newPos++;
                oldPos++;
                commonCount++;
                if (options.oneChangePerToken) {
                    basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
                }
            }
            if (commonCount && !options.oneChangePerToken) {
                basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
            }
            basePath.oldPos = oldPos;
            return newPos;
        }
        equals(left, right, options) {
            if (options.comparator) {
                return options.comparator(left, right);
            }
            else {
                return left === right
                    || (!!options.ignoreCase && left.toLowerCase() === right.toLowerCase());
            }
        }
        removeEmpty(array) {
            const ret = [];
            for (let i = 0; i < array.length; i++) {
                if (array[i]) {
                    ret.push(array[i]);
                }
            }
            return ret;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        castInput(value, options) {
            return value;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        tokenize(value, options) {
            return Array.from(value);
        }
        join(chars) {
            // Assumes ValueT is string, which is the case for most subclasses.
            // When it's false, e.g. in diffArrays, this method needs to be overridden (e.g. with a no-op)
            // Yes, the casts are verbose and ugly, because this pattern - of having the base class SORT OF
            // assume tokens and values are strings, but not completely - is weird and janky.
            return chars.join('');
        }
        postProcess(changeObjects, 
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        options) {
            return changeObjects;
        }
        get useLongestToken() {
            return false;
        }
        buildValues(lastComponent, newTokens, oldTokens) {
            // First we convert our linked list of components in reverse order to an
            // array in the right order:
            const components = [];
            let nextComponent;
            while (lastComponent) {
                components.push(lastComponent);
                nextComponent = lastComponent.previousComponent;
                delete lastComponent.previousComponent;
                lastComponent = nextComponent;
            }
            components.reverse();
            const componentLen = components.length;
            let componentPos = 0, newPos = 0, oldPos = 0;
            for (; componentPos < componentLen; componentPos++) {
                const component = components[componentPos];
                if (!component.removed) {
                    if (!component.added && this.useLongestToken) {
                        let value = newTokens.slice(newPos, newPos + component.count);
                        value = value.map(function (value, i) {
                            const oldValue = oldTokens[oldPos + i];
                            return oldValue.length > value.length ? oldValue : value;
                        });
                        component.value = this.join(value);
                    }
                    else {
                        component.value = this.join(newTokens.slice(newPos, newPos + component.count));
                    }
                    newPos += component.count;
                    // Common case
                    if (!component.added) {
                        oldPos += component.count;
                    }
                }
                else {
                    component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
                    oldPos += component.count;
                }
            }
            return components;
        }
    }

    class CharacterDiff extends Diff {
    }
    const characterDiff = new CharacterDiff();
    function diffChars(oldStr, newStr, options) {
        return characterDiff.diff(oldStr, newStr, options);
    }

    function longestCommonPrefix(str1, str2) {
        let i;
        for (i = 0; i < str1.length && i < str2.length; i++) {
            if (str1[i] != str2[i]) {
                return str1.slice(0, i);
            }
        }
        return str1.slice(0, i);
    }
    function longestCommonSuffix(str1, str2) {
        let i;
        // Unlike longestCommonPrefix, we need a special case to handle all scenarios
        // where we return the empty string since str1.slice(-0) will return the
        // entire string.
        if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) {
            return '';
        }
        for (i = 0; i < str1.length && i < str2.length; i++) {
            if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) {
                return str1.slice(-i);
            }
        }
        return str1.slice(-i);
    }
    function replacePrefix(string, oldPrefix, newPrefix) {
        if (string.slice(0, oldPrefix.length) != oldPrefix) {
            throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
        }
        return newPrefix + string.slice(oldPrefix.length);
    }
    function replaceSuffix(string, oldSuffix, newSuffix) {
        if (!oldSuffix) {
            return string + newSuffix;
        }
        if (string.slice(-oldSuffix.length) != oldSuffix) {
            throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
        }
        return string.slice(0, -oldSuffix.length) + newSuffix;
    }
    function removePrefix(string, oldPrefix) {
        return replacePrefix(string, oldPrefix, '');
    }
    function removeSuffix(string, oldSuffix) {
        return replaceSuffix(string, oldSuffix, '');
    }
    function maximumOverlap(string1, string2) {
        return string2.slice(0, overlapCount(string1, string2));
    }
    // Nicked from https://stackoverflow.com/a/60422853/1709587
    function overlapCount(a, b) {
        // Deal with cases where the strings differ in length
        let startA = 0;
        if (a.length > b.length) {
            startA = a.length - b.length;
        }
        let endB = b.length;
        if (a.length < b.length) {
            endB = a.length;
        }
        // Create a back-reference for each index
        //   that should be followed in case of a mismatch.
        //   We only need B to make these references:
        const map = Array(endB);
        let k = 0; // Index that lags behind j
        map[0] = 0;
        for (let j = 1; j < endB; j++) {
            if (b[j] == b[k]) {
                map[j] = map[k]; // skip over the same character (optional optimisation)
            }
            else {
                map[j] = k;
            }
            while (k > 0 && b[j] != b[k]) {
                k = map[k];
            }
            if (b[j] == b[k]) {
                k++;
            }
        }
        // Phase 2: use these references while iterating over A
        k = 0;
        for (let i = startA; i < a.length; i++) {
            while (k > 0 && a[i] != b[k]) {
                k = map[k];
            }
            if (a[i] == b[k]) {
                k++;
            }
        }
        return k;
    }
    /**
     * Returns true if the string consistently uses Windows line endings.
     */
    function hasOnlyWinLineEndings(string) {
        return string.includes('\r\n') && !string.startsWith('\n') && !string.match(/[^\r]\n/);
    }
    /**
     * Returns true if the string consistently uses Unix line endings.
     */
    function hasOnlyUnixLineEndings(string) {
        return !string.includes('\r\n') && string.includes('\n');
    }
    /**
     * Split a string into segments using a word segmenter, merging consecutive
     * segments if they are both whitespace segments. Whitespace segments can
     * appear adjacent to one another for two reasons:
     * - newlines always get their own segment
     * - where a diacritic is attached to a whitespace character in the text, the
     *   segment ends after the diacritic, so e.g. " \u0300 " becomes two segments.
     * This function therefore runs the segmenter's .segment() method and then
     * merges consecutive segments of whitespace into a single part.
     */
    function segment(string, segmenter) {
        const parts = [];
        for (const segmentObj of Array.from(segmenter.segment(string))) {
            const segment = segmentObj.segment;
            if (parts.length && (/\s/).test(parts[parts.length - 1]) && (/\s/).test(segment)) {
                parts[parts.length - 1] += segment;
            }
            else {
                parts.push(segment);
            }
        }
        return parts;
    }
    // The functions below take a `segmenter` argument so that, when called from
    // diffWords when it is using a segmenter, they can use a notion of what
    // constitutes "whitespace" that is consistent with the segmenter.
    //
    // USUALLY this will be identical to the result of the non-segmenter-based
    // logic, but it differs in at least one case: when whitespace characters are
    // modified by diacritics. A word segmenter considers these diacritics to be
    // part of the whitespace, whereas our non-segmenter-based logic does not.
    //
    // Because the segmenter-based approach necessarily requires segmenting the
    // entire string, we offer a leadingAndTrailingWs function to allow getting the
    // whitespace prefix AND whitespace suffix with a single call to the segmenter,
    // for efficiency's sake.
    function trailingWs(string, segmenter) {
        if (segmenter) {
            return leadingAndTrailingWs(string, segmenter)[1];
        }
        // Yes, this looks overcomplicated and dumb - why not replace the whole function with
        //     return string.match(/\s*$/)[0]
        // you ask? Because:
        // 1. the trap described at https://markamery.com/blog/quadratic-time-regexes/ would mean doing
        //    this would cause this function to take O(n²) time in the worst case (specifically when
        //    there is a massive run of NON-TRAILING whitespace in `string`), and
        // 2. the fix proposed in the same blog post, of using a negative lookbehind, is incompatible
        //    with old Safari versions that we'd like to not break if possible (see
        //    https://github.com/kpdecker/jsdiff/pull/550)
        // It feels absurd to do this with an explicit loop instead of a regex, but I really can't see a
        // better way that doesn't result in broken behaviour.
        let i;
        for (i = string.length - 1; i >= 0; i--) {
            if (!string[i].match(/\s/)) {
                break;
            }
        }
        return string.substring(i + 1);
    }
    function leadingWs(string, segmenter) {
        if (segmenter) {
            return leadingAndTrailingWs(string, segmenter)[0];
        }
        // Thankfully the annoying considerations described in trailingWs don't apply here:
        const match = string.match(/^\s*/);
        return match ? match[0] : '';
    }
    function leadingAndTrailingWs(string, segmenter) {
        if (!segmenter) {
            return [leadingWs(string), trailingWs(string)];
        }
        if (segmenter.resolvedOptions().granularity != 'word') {
            throw new Error('The segmenter passed must have a granularity of "word"');
        }
        const segments = segment(string, segmenter);
        const firstSeg = segments[0];
        const lastSeg = segments[segments.length - 1];
        const head = (/\s/).test(firstSeg) ? firstSeg : '';
        const tail = (/\s/).test(lastSeg) ? lastSeg : '';
        return [head, tail];
    }

    // Based on https://en.wikipedia.org/wiki/Latin_script_in_Unicode
    //
    // Chars/ranges counted as "word" characters by this regex are as follows:
    //
    // + U+00AD  Soft hyphen
    // + 00C0–00FF (letters with diacritics from the Latin-1 Supplement), except:
    //   - U+00D7  × Multiplication sign
    //   - U+00F7  ÷ Division sign
    // + Latin Extended-A, 0100–017F
    // + Latin Extended-B, 0180–024F
    // + IPA Extensions, 0250–02AF
    // + Spacing Modifier Letters, 02B0–02FF, except:
    //   - U+02C7  ˇ &#711;  Caron
    //   - U+02D8  ˘ &#728;  Breve
    //   - U+02D9  ˙ &#729;  Dot Above
    //   - U+02DA  ˚ &#730;  Ring Above
    //   - U+02DB  ˛ &#731;  Ogonek
    //   - U+02DC  ˜ &#732;  Small Tilde
    //   - U+02DD  ˝ &#733;  Double Acute Accent
    // + Latin Extended Additional, 1E00–1EFF
    const extendedWordChars = 'a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}';
    // Each token is one of the following:
    // - A punctuation mark plus the surrounding whitespace
    // - A word plus the surrounding whitespace
    // - Pure whitespace (but only in the special case where the entire text
    //   is just whitespace)
    //
    // We have to include surrounding whitespace in the tokens because the two
    // alternative approaches produce horribly broken results:
    // * If we just discard the whitespace, we can't fully reproduce the original
    //   text from the sequence of tokens and any attempt to render the diff will
    //   get the whitespace wrong.
    // * If we have separate tokens for whitespace, then in a typical text every
    //   second token will be a single space character. But this often results in
    //   the optimal diff between two texts being a perverse one that preserves
    //   the spaces between words but deletes and reinserts actual common words.
    //   See https://github.com/kpdecker/jsdiff/issues/160#issuecomment-1866099640
    //   for an example.
    //
    // Keeping the surrounding whitespace of course has implications for .equals
    // and .join, not just .tokenize.
    // This regex does NOT fully implement the tokenization rules described above.
    // Instead, it gives runs of whitespace their own "token". The tokenize method
    // then handles stitching whitespace tokens onto adjacent word or punctuation
    // tokens.
    const tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, 'ug');
    class WordDiff extends Diff {
        equals(left, right, options) {
            if (options.ignoreCase) {
                left = left.toLowerCase();
                right = right.toLowerCase();
            }
            return left.trim() === right.trim();
        }
        tokenize(value, options = {}) {
            let parts;
            if (options.intlSegmenter) {
                const segmenter = options.intlSegmenter;
                if (segmenter.resolvedOptions().granularity != 'word') {
                    throw new Error('The segmenter passed must have a granularity of "word"');
                }
                // We want `parts` to be an array whose elements alternate between being
                // pure whitespace and being pure non-whitespace. This is ALMOST what the
                // segments returned by a word-based Intl.Segmenter already look like,
                // but not quite - see explanation in the docs of our custom segment()
                // function.
                parts = segment(value, segmenter);
            }
            else {
                parts = value.match(tokenizeIncludingWhitespace) || [];
            }
            const tokens = [];
            let prevPart = null;
            parts.forEach(part => {
                if ((/\s/).test(part)) {
                    if (prevPart == null) {
                        tokens.push(part);
                    }
                    else {
                        tokens.push(tokens.pop() + part);
                    }
                }
                else if (prevPart != null && (/\s/).test(prevPart)) {
                    if (tokens[tokens.length - 1] == prevPart) {
                        tokens.push(tokens.pop() + part);
                    }
                    else {
                        tokens.push(prevPart + part);
                    }
                }
                else {
                    tokens.push(part);
                }
                prevPart = part;
            });
            return tokens;
        }
        join(tokens) {
            // Tokens being joined here will always have appeared consecutively in the
            // same text, so we can simply strip off the leading whitespace from all the
            // tokens except the first (and except any whitespace-only tokens - but such
            // a token will always be the first and only token anyway) and then join them
            // and the whitespace around words and punctuation will end up correct.
            return tokens.map((token, i) => {
                if (i == 0) {
                    return token;
                }
                else {
                    return token.replace((/^\s+/), '');
                }
            }).join('');
        }
        postProcess(changes, options) {
            if (!changes || options.oneChangePerToken) {
                return changes;
            }
            let lastKeep = null;
            // Change objects representing any insertion or deletion since the last
            // "keep" change object. There can be at most one of each.
            let insertion = null;
            let deletion = null;
            changes.forEach(change => {
                if (change.added) {
                    insertion = change;
                }
                else if (change.removed) {
                    deletion = change;
                }
                else {
                    if (insertion || deletion) { // May be false at start of text
                        dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
                    }
                    lastKeep = change;
                    insertion = null;
                    deletion = null;
                }
            });
            if (insertion || deletion) {
                dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
            }
            return changes;
        }
    }
    const wordDiff = new WordDiff();
    function diffWords(oldStr, newStr, options) {
        // This option has never been documented and never will be (it's clearer to
        // just call `diffWordsWithSpace` directly if you need that behavior), but
        // has existed in jsdiff for a long time, so we retain support for it here
        // for the sake of backwards compatibility.
        if ((options === null || options === void 0 ? void 0 : options.ignoreWhitespace) != null && !options.ignoreWhitespace) {
            return diffWordsWithSpace(oldStr, newStr, options);
        }
        return wordDiff.diff(oldStr, newStr, options);
    }
    function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
        // Before returning, we tidy up the leading and trailing whitespace of the
        // change objects to eliminate cases where trailing whitespace in one object
        // is repeated as leading whitespace in the next.
        // Below are examples of the outcomes we want here to explain the code.
        // I=insert, K=keep, D=delete
        // 1. diffing 'foo bar baz' vs 'foo baz'
        //    Prior to cleanup, we have K:'foo ' D:' bar ' K:' baz'
        //    After cleanup, we want:   K:'foo ' D:'bar ' K:'baz'
        //
        // 2. Diffing 'foo bar baz' vs 'foo qux baz'
        //    Prior to cleanup, we have K:'foo ' D:' bar ' I:' qux ' K:' baz'
        //    After cleanup, we want K:'foo ' D:'bar' I:'qux' K:' baz'
        //
        // 3. Diffing 'foo\nbar baz' vs 'foo baz'
        //    Prior to cleanup, we have K:'foo ' D:'\nbar ' K:' baz'
        //    After cleanup, we want K'foo' D:'\nbar' K:' baz'
        //
        // 4. Diffing 'foo baz' vs 'foo\nbar baz'
        //    Prior to cleanup, we have K:'foo\n' I:'\nbar ' K:' baz'
        //    After cleanup, we ideally want K'foo' I:'\nbar' K:' baz'
        //    but don't actually manage this currently (the pre-cleanup change
        //    objects don't contain enough information to make it possible).
        //
        // 5. Diffing 'foo   bar baz' vs 'foo  baz'
        //    Prior to cleanup, we have K:'foo  ' D:'   bar ' K:'  baz'
        //    After cleanup, we want K:'foo  ' D:' bar ' K:'baz'
        //
        // Our handling is unavoidably imperfect in the case where there's a single
        // indel between keeps and the whitespace has changed. For instance, consider
        // diffing 'foo\tbar\nbaz' vs 'foo baz'. Unless we create an extra change
        // object to represent the insertion of the space character (which isn't even
        // a token), we have no way to avoid losing information about the texts'
        // original whitespace in the result we return. Still, we do our best to
        // output something that will look sensible if we e.g. print it with
        // insertions in green and deletions in red.
        // Between two "keep" change objects (or before the first or after the last
        // change object), we can have either:
        // * A "delete" followed by an "insert"
        // * Just an "insert"
        // * Just a "delete"
        // We handle the three cases separately.
        if (deletion && insertion) {
            const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
            const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);
            if (startKeep) {
                const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
                startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
                deletion.value = removePrefix(deletion.value, commonWsPrefix);
                insertion.value = removePrefix(insertion.value, commonWsPrefix);
            }
            if (endKeep) {
                const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
                endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
                deletion.value = removeSuffix(deletion.value, commonWsSuffix);
                insertion.value = removeSuffix(insertion.value, commonWsSuffix);
            }
        }
        else if (insertion) {
            // The whitespaces all reflect what was in the new text rather than
            // the old, so we essentially have no information about whitespace
            // insertion or deletion. We just want to dedupe the whitespace.
            // We do that by having each change object keep its trailing
            // whitespace and deleting duplicate leading whitespace where
            // present.
            if (startKeep) {
                const ws = leadingWs(insertion.value, segmenter);
                insertion.value = insertion.value.substring(ws.length);
            }
            if (endKeep) {
                const ws = leadingWs(endKeep.value, segmenter);
                endKeep.value = endKeep.value.substring(ws.length);
            }
            // otherwise we've got a deletion and no insertion
        }
        else if (startKeep && endKeep) {
            const newWsFull = leadingWs(endKeep.value, segmenter), [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion.value, segmenter);
            // Any whitespace that comes straight after startKeep in both the old and
            // new texts, assign to startKeep and remove from the deletion.
            const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
            deletion.value = removePrefix(deletion.value, newWsStart);
            // Any whitespace that comes straight before endKeep in both the old and
            // new texts, and hasn't already been assigned to startKeep, assign to
            // endKeep and remove from the deletion.
            const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
            deletion.value = removeSuffix(deletion.value, newWsEnd);
            endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
            // If there's any whitespace from the new text that HASN'T already been
            // assigned, assign it to the start:
            startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
        }
        else if (endKeep) {
            // We are at the start of the text. Preserve all the whitespace on
            // endKeep, and just remove whitespace from the end of deletion to the
            // extent that it overlaps with the start of endKeep.
            const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
            const deletionWsSuffix = trailingWs(deletion.value, segmenter);
            const overlap = maximumOverlap(deletionWsSuffix, endKeepWsPrefix);
            deletion.value = removeSuffix(deletion.value, overlap);
        }
        else if (startKeep) {
            // We are at the END of the text. Preserve all the whitespace on
            // startKeep, and just remove whitespace from the start of deletion to
            // the extent that it overlaps with the end of startKeep.
            const startKeepWsSuffix = trailingWs(startKeep.value, segmenter);
            const deletionWsPrefix = leadingWs(deletion.value, segmenter);
            const overlap = maximumOverlap(startKeepWsSuffix, deletionWsPrefix);
            deletion.value = removePrefix(deletion.value, overlap);
        }
    }
    class WordsWithSpaceDiff extends Diff {
        tokenize(value) {
            // Slightly different to the tokenizeIncludingWhitespace regex used above in
            // that this one treats each individual newline as a distinct token, rather
            // than merging them into other surrounding whitespace. This was requested
            // in https://github.com/kpdecker/jsdiff/issues/180 &
            //    https://github.com/kpdecker/jsdiff/issues/211
            const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, 'ug');
            return value.match(regex) || [];
        }
    }
    const wordsWithSpaceDiff = new WordsWithSpaceDiff();
    function diffWordsWithSpace(oldStr, newStr, options) {
        return wordsWithSpaceDiff.diff(oldStr, newStr, options);
    }

    function generateOptions(options, defaults) {
        if (typeof options === 'function') {
            defaults.callback = options;
        }
        else if (options) {
            for (const name in options) {
                /* istanbul ignore else */
                if (Object.prototype.hasOwnProperty.call(options, name)) {
                    defaults[name] = options[name];
                }
            }
        }
        return defaults;
    }

    class LineDiff extends Diff {
        constructor() {
            super(...arguments);
            this.tokenize = tokenize;
        }
        equals(left, right, options) {
            // If we're ignoring whitespace, we need to normalise lines by stripping
            // whitespace before checking equality. (This has an annoying interaction
            // with newlineIsToken that requires special handling: if newlines get their
            // own token, then we DON'T want to trim the *newline* tokens down to empty
            // strings, since this would cause us to treat whitespace-only line content
            // as equal to a separator between lines, which would be weird and
            // inconsistent with the documented behavior of the options.)
            if (options.ignoreWhitespace) {
                if (!options.newlineIsToken || !left.includes('\n')) {
                    left = left.trim();
                }
                if (!options.newlineIsToken || !right.includes('\n')) {
                    right = right.trim();
                }
            }
            else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
                if (left.endsWith('\n')) {
                    left = left.slice(0, -1);
                }
                if (right.endsWith('\n')) {
                    right = right.slice(0, -1);
                }
            }
            return super.equals(left, right, options);
        }
    }
    const lineDiff = new LineDiff();
    function diffLines(oldStr, newStr, options) {
        return lineDiff.diff(oldStr, newStr, options);
    }
    function diffTrimmedLines(oldStr, newStr, options) {
        options = generateOptions(options, { ignoreWhitespace: true });
        return lineDiff.diff(oldStr, newStr, options);
    }
    // Exported standalone so it can be used from jsonDiff too.
    function tokenize(value, options) {
        if (options.stripTrailingCr) {
            // remove one \r before \n to match GNU diff's --strip-trailing-cr behavior
            value = value.replace(/\r\n/g, '\n');
        }
        const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
        // Ignore the final empty token that occurs if the string ends with a new line
        if (!linesAndNewlines[linesAndNewlines.length - 1]) {
            linesAndNewlines.pop();
        }
        // Merge the content and line separators into single tokens
        for (let i = 0; i < linesAndNewlines.length; i++) {
            const line = linesAndNewlines[i];
            if (i % 2 && !options.newlineIsToken) {
                retLines[retLines.length - 1] += line;
            }
            else {
                retLines.push(line);
            }
        }
        return retLines;
    }

    function isSentenceEndPunct(char) {
        return char == '.' || char == '!' || char == '?';
    }
    class SentenceDiff extends Diff {
        tokenize(value) {
            var _a;
            // If in future we drop support for environments that don't support lookbehinds, we can replace
            // this entire function with:
            //     return value.split(/(?<=[.!?])(\s+|$)/);
            // but until then, for similar reasons to the trailingWs function in string.ts, we are forced
            // to do this verbosely "by hand" instead of using a regex.
            const result = [];
            let tokenStartI = 0;
            for (let i = 0; i < value.length; i++) {
                if (i == value.length - 1) {
                    result.push(value.slice(tokenStartI));
                    break;
                }
                if (isSentenceEndPunct(value[i]) && value[i + 1].match(/\s/)) {
                    // We've hit a sentence break - i.e. a punctuation mark followed by whitespace.
                    // We now want to push TWO tokens to the result:
                    // 1. the sentence
                    result.push(value.slice(tokenStartI, i + 1));
                    // 2. the whitespace
                    i = tokenStartI = i + 1;
                    while ((_a = value[i + 1]) === null || _a === void 0 ? void 0 : _a.match(/\s/)) {
                        i++;
                    }
                    result.push(value.slice(tokenStartI, i + 1));
                    // Then the next token (a sentence) starts on the character after the whitespace.
                    // (It's okay if this is off the end of the string - then the outer loop will terminate
                    // here anyway.)
                    tokenStartI = i + 1;
                }
            }
            return result;
        }
    }
    const sentenceDiff = new SentenceDiff();
    function diffSentences(oldStr, newStr, options) {
        return sentenceDiff.diff(oldStr, newStr, options);
    }

    class CssDiff extends Diff {
        tokenize(value) {
            return value.split(/([{}:;,]|\s+)/);
        }
    }
    const cssDiff = new CssDiff();
    function diffCss(oldStr, newStr, options) {
        return cssDiff.diff(oldStr, newStr, options);
    }

    class JsonDiff extends Diff {
        constructor() {
            super(...arguments);
            this.tokenize = tokenize;
        }
        get useLongestToken() {
            // Discriminate between two lines of pretty-printed, serialized JSON where one of them has a
            // dangling comma and the other doesn't. Turns out including the dangling comma yields the nicest output:
            return true;
        }
        castInput(value, options) {
            const { undefinedReplacement, stringifyReplacer = (k, v) => typeof v === 'undefined' ? undefinedReplacement : v } = options;
            return typeof value === 'string' ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, '  ');
        }
        equals(left, right, options) {
            return super.equals(left.replace(/,([\r\n])/g, '$1'), right.replace(/,([\r\n])/g, '$1'), options);
        }
    }
    const jsonDiff = new JsonDiff();
    function diffJson(oldStr, newStr, options) {
        return jsonDiff.diff(oldStr, newStr, options);
    }
    // This function handles the presence of circular references by bailing out when encountering an
    // object that is already on the "stack" of items being processed. Accepts an optional replacer
    function canonicalize(obj, stack, replacementStack, replacer, key) {
        stack = stack || [];
        replacementStack = replacementStack || [];
        if (replacer) {
            obj = replacer(key === undefined ? '' : key, obj);
        }
        let i;
        for (i = 0; i < stack.length; i += 1) {
            if (stack[i] === obj) {
                return replacementStack[i];
            }
        }
        let canonicalizedObj;
        if ('[object Array]' === Object.prototype.toString.call(obj)) {
            stack.push(obj);
            canonicalizedObj = new Array(obj.length);
            replacementStack.push(canonicalizedObj);
            for (i = 0; i < obj.length; i += 1) {
                canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, String(i));
            }
            stack.pop();
            replacementStack.pop();
            return canonicalizedObj;
        }
        if (obj && obj.toJSON) {
            obj = obj.toJSON();
        }
        if (typeof obj === 'object' && obj !== null) {
            stack.push(obj);
            canonicalizedObj = {};
            replacementStack.push(canonicalizedObj);
            const sortedKeys = [];
            let key;
            for (key in obj) {
                /* istanbul ignore else */
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    sortedKeys.push(key);
                }
            }
            sortedKeys.sort();
            for (i = 0; i < sortedKeys.length; i += 1) {
                key = sortedKeys[i];
                canonicalizedObj[key] = canonicalize(obj[key], stack, replacementStack, replacer, key);
            }
            stack.pop();
            replacementStack.pop();
        }
        else {
            canonicalizedObj = obj;
        }
        return canonicalizedObj;
    }

    class ArrayDiff extends Diff {
        tokenize(value) {
            return value.slice();
        }
        join(value) {
            return value;
        }
        removeEmpty(value) {
            return value;
        }
    }
    const arrayDiff = new ArrayDiff();
    function diffArrays(oldArr, newArr, options) {
        return arrayDiff.diff(oldArr, newArr, options);
    }

    function unixToWin(patch) {
        if (Array.isArray(patch)) {
            // It would be cleaner if instead of the line below we could just write
            //     return patch.map(unixToWin)
            // but mysteriously TypeScript (v5.7.3 at the time of writing) does not like this and it will
            // refuse to compile, thinking that unixToWin could then return StructuredPatch[][] and the
            // result would be incompatible with the overload signatures.
            // See bug report at https://github.com/microsoft/TypeScript/issues/61398.
            return patch.map(p => unixToWin(p));
        }
        return Object.assign(Object.assign({}, patch), { hunks: patch.hunks.map(hunk => (Object.assign(Object.assign({}, hunk), { lines: hunk.lines.map((line, i) => {
                    var _a;
                    return (line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')))
                        ? line
                        : line + '\r';
                }) }))) });
    }
    function winToUnix(patch) {
        if (Array.isArray(patch)) {
            // (See comment above equivalent line in unixToWin)
            return patch.map(p => winToUnix(p));
        }
        return Object.assign(Object.assign({}, patch), { hunks: patch.hunks.map(hunk => (Object.assign(Object.assign({}, hunk), { lines: hunk.lines.map(line => line.endsWith('\r') ? line.substring(0, line.length - 1) : line) }))) });
    }
    /**
     * Returns true if the patch consistently uses Unix line endings (or only involves one line and has
     * no line endings).
     */
    function isUnix(patch) {
        if (!Array.isArray(patch)) {
            patch = [patch];
        }
        return !patch.some(index => index.hunks.some(hunk => hunk.lines.some(line => !line.startsWith('\\') && line.endsWith('\r'))));
    }
    /**
     * Returns true if the patch uses Windows line endings and only Windows line endings.
     */
    function isWin(patch) {
        if (!Array.isArray(patch)) {
            patch = [patch];
        }
        return patch.some(index => index.hunks.some(hunk => hunk.lines.some(line => line.endsWith('\r'))))
            && patch.every(index => index.hunks.every(hunk => hunk.lines.every((line, i) => { var _a; return line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')); })));
    }

    /**
     * Parses a unified diff format patch into a structured patch object.
     *
     * `parsePatch` has some understanding of Git's particular dialect of unified diff format.
     * When parsing a Git patch, each index in the result may contain additional
     * fields (`isRename`, `isBinary`, etc) not included in the data structure returned by
     * `structuredPatch`; see the `StructuredPatch` interface for a full list.
     *
     * @return a JSON object representation of the patch, suitable for use with the `applyPatch`
     * method. This parses to the same structure returned by `structuredPatch`, except that
     * `oldFileName` and `newFileName` may be `undefined` if the patch doesn't contain enough
     * information to determine them (e.g. a hunk-only patch with no file headers).
     */
    function parsePatch(uniDiff) {
        const diffstr = uniDiff.split(/\n/), list = [];
        let i = 0;
        // These helper functions identify line types that can appear between files
        // in a multi-file patch. Keeping them in one place avoids subtle
        // inconsistencies from having the same regexes duplicated in multiple places.
        // Matches `diff --git ...` lines specifically.
        function isGitDiffHeader(line) {
            return (/^diff --git /).test(line);
        }
        // Matches lines that denote the start of a new diff's section in a
        // multi-file patch: `diff --git ...`, `Index: ...`, or `diff -r ...`.
        function isDiffHeader(line) {
            return isGitDiffHeader(line)
                || (/^Index:\s/).test(line)
                || (/^diff(?: -r \w+)+\s/).test(line);
        }
        // Matches `--- ...` and `+++ ...` file header lines.
        function isFileHeader(line) {
            return (/^(---|\+\+\+)\s/).test(line);
        }
        // Matches `@@ ...` hunk header lines.
        function isHunkHeader(line) {
            return (/^@@\s/).test(line);
        }
        function parseIndex() {
            var _a;
            const index = {};
            index.hunks = [];
            list.push(index);
            // Parse diff metadata
            let seenDiffHeader = false;
            while (i < diffstr.length) {
                const line = diffstr[i];
                // File header (---, +++) or hunk header (@@) found; end parsing diff metadata
                if (isFileHeader(line) || isHunkHeader(line)) {
                    break;
                }
                // The next two branches handle recognized diff headers. Note that
                // isDiffHeader deliberately does NOT match arbitrary `diff`
                // commands like `diff -u -p -r1.1 -r1.2`, because in some
                // formats (e.g. CVS diffs) such lines appear as metadata within
                // a single file's header section, after an `Index:` line. See the
                // diffx documentation (https://diffx.org) for examples.
                //
                // In both branches: if we've already seen a diff header for *this*
                // file and now we encounter another one, it must belong to the
                // next file, so break.
                if (isGitDiffHeader(line)) {
                    if (seenDiffHeader) {
                        return;
                    }
                    seenDiffHeader = true;
                    index.isGit = true;
                    // Parse the old and new filenames from the `diff --git` header and
                    // tentatively set oldFileName and newFileName from them. These may
                    // be overridden below by `rename from` / `rename to` or `copy from` /
                    // `copy to` extended headers, or by --- and +++ lines. But for Git
                    // diffs that lack all of those (e.g. mode-only changes, binary
                    // file changes without rename), these are the only filenames we
                    // get.
                    // parseGitDiffHeader returns null if the header can't be parsed
                    // (e.g. unterminated quoted filename, or unexpected format). In
                    // that case we skip setting filenames here; they may still be
                    // set from --- / +++ or rename from / rename to lines below.
                    const paths = parseGitDiffHeader(line);
                    if (paths) {
                        index.oldFileName = paths.oldFileName;
                        index.newFileName = paths.newFileName;
                    }
                    // Consume Git extended headers (`old mode`, `new mode`, `rename from`,
                    // `rename to`, `similarity index`, `index`, `Binary files ... differ`,
                    // etc.)
                    i++;
                    while (i < diffstr.length) {
                        const extLine = diffstr[i];
                        // Stop consuming extended headers if we hit a file header,
                        // hunk header, or another diff header.
                        if (isFileHeader(extLine) || isHunkHeader(extLine) || isDiffHeader(extLine)) {
                            break;
                        }
                        // Parse `rename from` / `rename to` lines - these give us
                        // unambiguous filenames. These lines don't include the
                        // a/ and b/ prefixes that appear in the `diff --git` header
                        // and --- / +++ lines, so we add them for consistency.
                        // Git C-style quotes filenames containing special characters
                        // (tabs, newlines, backslashes, double quotes), so we must
                        // unquote them when present.
                        const renameFromMatch = (/^rename from (.*)/).exec(extLine);
                        if (renameFromMatch) {
                            index.oldFileName = 'a/' + unquoteIfQuoted(renameFromMatch[1]);
                            index.isRename = true;
                        }
                        const renameToMatch = (/^rename to (.*)/).exec(extLine);
                        if (renameToMatch) {
                            index.newFileName = 'b/' + unquoteIfQuoted(renameToMatch[1]);
                            index.isRename = true;
                        }
                        // Parse copy from / copy to lines similarly
                        const copyFromMatch = (/^copy from (.*)/).exec(extLine);
                        if (copyFromMatch) {
                            index.oldFileName = 'a/' + unquoteIfQuoted(copyFromMatch[1]);
                            index.isCopy = true;
                        }
                        const copyToMatch = (/^copy to (.*)/).exec(extLine);
                        if (copyToMatch) {
                            index.newFileName = 'b/' + unquoteIfQuoted(copyToMatch[1]);
                            index.isCopy = true;
                        }
                        const newFileModeMatch = (/^new file mode (\d+)/).exec(extLine);
                        if (newFileModeMatch) {
                            index.isCreate = true;
                            index.newMode = newFileModeMatch[1];
                        }
                        const deletedFileModeMatch = (/^deleted file mode (\d+)/).exec(extLine);
                        if (deletedFileModeMatch) {
                            index.isDelete = true;
                            index.oldMode = deletedFileModeMatch[1];
                        }
                        const oldModeMatch = (/^old mode (\d+)/).exec(extLine);
                        if (oldModeMatch) {
                            index.oldMode = oldModeMatch[1];
                        }
                        const newModeMatch = (/^new mode (\d+)/).exec(extLine);
                        if (newModeMatch) {
                            index.newMode = newModeMatch[1];
                        }
                        if ((/^Binary files /).test(extLine)) {
                            index.isBinary = true;
                        }
                        i++;
                    }
                    continue;
                }
                else if (isDiffHeader(line)) {
                    if (seenDiffHeader) {
                        return;
                    }
                    seenDiffHeader = true;
                    // For Mercurial-style headers like
                    //     diff -r 9117c6561b0b -r 273ce12ad8f1 .hgignore
                    // or Index: headers like
                    //     Index: something with multiple words
                    // we extract the trailing filename as the index.
                    //
                    // TODO: It seems awkward that we indiscriminately trim off
                    //       trailing whitespace here. Theoretically, couldn't that
                    //       be meaningful - e.g. if the patch represents a diff of a
                    //       file whose name ends with a space? Seems wrong to nuke
                    //       it. But this behaviour has been around since v2.2.1 in
                    //       2015, so if it's going to change, it should be done
                    //       cautiously and in a new major release, for
                    //       backwards-compat reasons.
                    //       -- ExplodingCabbage
                    const headerMatch = (/^(?:Index:|diff(?: -r \w+)+)\s+/).exec(line);
                    if (headerMatch) {
                        index.index = line.substring(headerMatch[0].length).trim();
                    }
                }
                i++;
            }
            // Parse file headers if they are defined. Unified diff requires them, but
            // there's no technical issues to have an isolated hunk without file header
            parseFileHeader(index);
            parseFileHeader(index);
            // If we got one file header but not the other, that's a malformed patch.
            if ((index.oldFileName === undefined) !== (index.newFileName === undefined)) {
                throw new Error('Missing ' + (index.oldFileName !== undefined ? '"+++ ..."' : '"--- ..."')
                    + ' file header for ' + ((_a = index.oldFileName) !== null && _a !== void 0 ? _a : index.newFileName));
            }
            while (i < diffstr.length) {
                const line = diffstr[i];
                if (isDiffHeader(line) || isFileHeader(line) || (/^===================================================================/).test(line)) {
                    break;
                }
                else if (isHunkHeader(line)) {
                    index.hunks.push(parseHunk());
                }
                else {
                    // Skip blank lines and any other unrecognized content between
                    // or after hunks. Real-world examples of such content include:
                    //   - `Only in <dir>: <file>` from GNU `diff -r`
                    //   - `Property changes on:` sections from `svn diff`
                    //   - Trailing prose or commentary in email patches
                    // GNU `patch` tolerates all of these, and so do we.
                    i++;
                }
            }
        }
        /**
         * Parses the old and new filenames from a `diff --git` header line.
         *
         * The format is:
         *     diff --git a/<old-path> b/<new-path>
         *
         * When filenames contain special characters (including newlines, tabs,
         * backslashes, or double quotes), Git quotes them with C-style escaping:
         *     diff --git "a/file\twith\ttabs.txt" "b/file\twith\ttabs.txt"
         *
         * When filenames don't contain special characters and the old and new names
         * are the same, we can unambiguously split on ` b/` by finding where the
         * two halves (including their a/ and b/ prefixes) yield matching bare names.
         *
         * A pathological case exists in which we cannot reliably determine the paths
         * from the `diff --git` header. This case is when the following are true:
         * - the old and new file paths differ
         * - they are both unquoted (i.e. contain no special characters)
         * - at least one of the underlying file paths includes the substring ` b/`
         * In this scenario, we do not know which occurrence of ` b/` indicates the
         * start of the new file path, so the header is inherently ambiguous. We thus
         * select a possible interpretation arbitrarily and return that.
         *
         * Fortunately, this ambiguity should never matter, because in any patch
         * genuinely output by Git in which this pathological scenario occurs, there
         * must also be `rename from`/`rename to` or `copy from`/`copy to` extended
         * headers present below the `diff --git` header. `parseIndex` will parse
         * THOSE headers, from which we CAN unambiguously determine the filenames,
         * and will discard the result returned by this function.
         *
         * Returns null if the header can't be parsed at all — e.g. a quoted filename
         * has an unterminated quote, or if the unquoted header doesn't match the
         * expected `a/... b/...` format. In that case, the caller (parseIndex)
         * skips setting oldFileName/newFileName from this header, but they may
         * still be set later from `---`/`+++` lines or `rename from`/`rename to`
         * extended headers; if none of those are present either, they'll remain
         * undefined in the output.
         */
        function parseGitDiffHeader(line) {
            // Strip the "diff --git " prefix
            const rest = line.substring('diff --git '.length);
            // Handle quoted paths: "a/path" "b/path"
            // Git quotes paths when they contain characters like newlines, tabs,
            // backslashes, or double quotes (but notably not spaces).
            if (rest.startsWith('"')) {
                const oldPath = parseQuotedFileName(rest);
                if (oldPath === null) {
                    return null;
                }
                const afterOld = rest.substring(oldPath.rawLength + 1); // +1 for space
                let newFileName;
                if (afterOld.startsWith('"')) {
                    const newPath = parseQuotedFileName(afterOld);
                    if (newPath === null) {
                        return null;
                    }
                    newFileName = newPath.fileName;
                }
                else {
                    newFileName = afterOld;
                }
                return {
                    oldFileName: oldPath.fileName,
                    newFileName
                };
            }
            // Check if the second path is quoted
            // e.g. diff --git a/simple "b/renamed\nnewline.txt"
            const quoteIdx = rest.indexOf('"');
            if (quoteIdx > 0) {
                const oldFileName = rest.substring(0, quoteIdx - 1);
                const newPath = parseQuotedFileName(rest.substring(quoteIdx));
                if (newPath === null) {
                    return null;
                }
                return {
                    oldFileName,
                    newFileName: newPath.fileName
                };
            }
            // Unquoted paths. Try to find the split point.
            // The format is: a/<old-path> b/<new-path>
            //
            // Note the potential ambiguity caused by the possibility of the file paths
            // themselves containing the substring ` b/`, plus the pathological case
            // described in the comment above.
            //
            // Strategy: find all occurrences of " b/" and split on the middle
            // one. When old and new names are the same (which is the only case where
            // we can't rely on extended headers later in the patch so HAVE to get
            // this right), this will always be the correct split.
            if (rest.startsWith('a/')) {
                const splits = [];
                let idx = 0;
                while (true) {
                    idx = rest.indexOf(' b/', idx + 1);
                    if (idx === -1) {
                        break;
                    }
                    splits.push(idx);
                }
                if (splits.length > 0) {
                    const mid = splits[Math.floor(splits.length / 2)];
                    return {
                        oldFileName: rest.substring(0, mid),
                        newFileName: rest.substring(mid + 1)
                    };
                }
            }
            // Fallback: can't parse, return null
            return null;
        }
        /**
         * If `s` starts with a double quote, unquotes it using C-style escape
         * rules (as used by Git). Otherwise returns `s` as-is.
         */
        function unquoteIfQuoted(s) {
            if (s.startsWith('"')) {
                const parsed = parseQuotedFileName(s);
                if (parsed) {
                    return parsed.fileName;
                }
            }
            return s;
        }
        /**
         * Parses a C-style quoted filename as used by Git or GNU `diff -u`.
         * Returns the unescaped filename and the raw length consumed (including quotes).
         */
        function parseQuotedFileName(s) {
            if (!s.startsWith('"')) {
                return null;
            }
            let result = '';
            let j = 1; // skip opening quote
            while (j < s.length) {
                if (s[j] === '"') {
                    return { fileName: result, rawLength: j + 1 };
                }
                if (s[j] === '\\' && j + 1 < s.length) {
                    j++;
                    switch (s[j]) {
                        case 'a':
                            result += '\x07';
                            break;
                        case 'b':
                            result += '\b';
                            break;
                        case 'f':
                            result += '\f';
                            break;
                        case 'n':
                            result += '\n';
                            break;
                        case 'r':
                            result += '\r';
                            break;
                        case 't':
                            result += '\t';
                            break;
                        case 'v':
                            result += '\v';
                            break;
                        case '\\':
                            result += '\\';
                            break;
                        case '"':
                            result += '"';
                            break;
                        case '0':
                        case '1':
                        case '2':
                        case '3':
                        case '4':
                        case '5':
                        case '6':
                        case '7': {
                            // C-style octal escapes represent raw bytes. Collect
                            // consecutive octal-escaped bytes and decode as UTF-8.
                            // Validate that we have a full 3-digit octal escape
                            if (j + 2 >= s.length || s[j + 1] < '0' || s[j + 1] > '7' || s[j + 2] < '0' || s[j + 2] > '7') {
                                return null;
                            }
                            const bytes = [parseInt(s.substring(j, j + 3), 8)];
                            j += 3;
                            while (s[j] === '\\' && s[j + 1] >= '0' && s[j + 1] <= '7') {
                                if (j + 3 >= s.length || s[j + 2] < '0' || s[j + 2] > '7' || s[j + 3] < '0' || s[j + 3] > '7') {
                                    return null;
                                }
                                bytes.push(parseInt(s.substring(j + 1, j + 4), 8));
                                j += 4;
                            }
                            result += new TextDecoder('utf-8').decode(new Uint8Array(bytes));
                            continue; // j already points at the next character
                        }
                        // Note that in C, there are also three kinds of hex escape sequences:
                        // - \xhh
                        // - \uhhhh
                        // - \Uhhhhhhhh
                        // We do not bother to parse them here because, so far as we know,
                        // they are never emitted by any tools that generate unified diff
                        // format diffs, and so for now jsdiff does not consider them legal.
                        default: return null;
                    }
                }
                else {
                    result += s[j];
                }
                j++;
            }
            // Unterminated quote
            return null;
        }
        // Parses the --- and +++ headers, if none are found, no lines
        // are consumed.
        function parseFileHeader(index) {
            const fileHeaderMatch = (/^(---|\+\+\+)\s+/).exec(diffstr[i]);
            if (fileHeaderMatch) {
                const prefix = fileHeaderMatch[1], data = diffstr[i].substring(3).trim().split('\t', 2), header = (data[1] || '').trim();
                let fileName = data[0];
                if (fileName.startsWith('"')) {
                    fileName = unquoteIfQuoted(fileName);
                }
                else {
                    fileName = fileName.replace(/\\\\/g, '\\');
                }
                if (prefix === '---') {
                    index.oldFileName = fileName;
                    index.oldHeader = header;
                }
                else {
                    index.newFileName = fileName;
                    index.newHeader = header;
                }
                i++;
            }
        }
        // Parses a hunk
        // This assumes that we are at the start of a hunk.
        function parseHunk() {
            var _a;
            const chunkHeaderIndex = i, chunkHeaderLine = diffstr[i++], chunkHeader = chunkHeaderLine.split(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            const hunk = {
                oldStart: +chunkHeader[1],
                oldLines: typeof chunkHeader[2] === 'undefined' ? 1 : +chunkHeader[2],
                newStart: +chunkHeader[3],
                newLines: typeof chunkHeader[4] === 'undefined' ? 1 : +chunkHeader[4],
                lines: []
            };
            // Unified Diff Format quirk: If the chunk size is 0,
            // the first number is one lower than one would expect.
            // https://www.artima.com/weblogs/viewpost.jsp?thread=164293
            if (hunk.oldLines === 0) {
                hunk.oldStart += 1;
            }
            if (hunk.newLines === 0) {
                hunk.newStart += 1;
            }
            let addCount = 0, removeCount = 0;
            for (; i < diffstr.length && (removeCount < hunk.oldLines || addCount < hunk.newLines || ((_a = diffstr[i]) === null || _a === void 0 ? void 0 : _a.startsWith('\\'))); i++) {
                const operation = (diffstr[i].length == 0 && i != (diffstr.length - 1)) ? ' ' : diffstr[i][0];
                if (operation === '+' || operation === '-' || operation === ' ' || operation === '\\') {
                    hunk.lines.push(diffstr[i]);
                    if (operation === '+') {
                        addCount++;
                    }
                    else if (operation === '-') {
                        removeCount++;
                    }
                    else if (operation === ' ') {
                        addCount++;
                        removeCount++;
                    }
                }
                else {
                    throw new Error(`Hunk at line ${chunkHeaderIndex + 1} contained invalid line ${diffstr[i]}`);
                }
            }
            // Handle the empty block count case
            if (!addCount && hunk.newLines === 1) {
                hunk.newLines = 0;
            }
            if (!removeCount && hunk.oldLines === 1) {
                hunk.oldLines = 0;
            }
            // Perform sanity checking
            if (addCount !== hunk.newLines) {
                throw new Error('Added line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
            }
            if (removeCount !== hunk.oldLines) {
                throw new Error('Removed line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
            }
            // Check for extra hunk-body-like lines after the declared line counts
            // were exhausted. If the very next line starts with ' ', '+', or '-',
            // the hunk's line counts were probably wrong — unless it's a file
            // header (--- or +++), which legitimately appears immediately after a
            // hunk in multi-file diffs without Index lines.
            if (i < diffstr.length && diffstr[i] && (/^[+ -]/).test(diffstr[i])
                && !isFileHeader(diffstr[i])) {
                throw new Error('Hunk at line ' + (chunkHeaderIndex + 1)
                    + ' has more lines than expected (expected '
                    + hunk.oldLines + ' old lines and ' + hunk.newLines + ' new lines)');
            }
            return hunk;
        }
        while (i < diffstr.length) {
            parseIndex();
        }
        return list;
    }

    // Iterator that traverses in the range of [min, max], stepping
    // by distance from a given start position. I.e. for [0, 4], with
    // start of 2, this will iterate 2, 3, 1, 4, 0.
    function distanceIterator (start, minLine, maxLine) {
        let wantForward = true, backwardExhausted = false, forwardExhausted = false, localOffset = 1;
        return function iterator() {
            if (wantForward && !forwardExhausted) {
                if (backwardExhausted) {
                    localOffset++;
                }
                else {
                    wantForward = false;
                }
                // Check if trying to fit beyond text length, and if not, check it fits
                // after offset location (or desired location on first iteration)
                if (start + localOffset <= maxLine) {
                    return start + localOffset;
                }
                forwardExhausted = true;
            }
            if (!backwardExhausted) {
                if (!forwardExhausted) {
                    wantForward = true;
                }
                // Check if trying to fit before text beginning, and if not, check it fits
                // before offset location
                if (minLine <= start - localOffset) {
                    return start - localOffset++;
                }
                backwardExhausted = true;
                return iterator();
            }
            // We tried to fit hunk before text beginning and beyond text length, then
            // hunk can't fit on the text. Return undefined
            return undefined;
        };
    }

    /**
     * attempts to apply a unified diff patch.
     *
     * Hunks are applied first to last.
     * `applyPatch` first tries to apply the first hunk at the line number specified in the hunk header, and with all context lines matching exactly.
     * If that fails, it tries scanning backwards and forwards, one line at a time, to find a place to apply the hunk where the context lines match exactly.
     * If that still fails, and `fuzzFactor` is greater than zero, it increments the maximum number of mismatches (missing, extra, or changed context lines) that there can be between the hunk context and a region where we are trying to apply the patch such that the hunk will still be considered to match.
     * Regardless of `fuzzFactor`, lines to be deleted in the hunk *must* be present for a hunk to match, and the context lines *immediately* before and after an insertion must match exactly.
     *
     * Once a hunk is successfully fitted, the process begins again with the next hunk.
     * Regardless of `fuzzFactor`, later hunks must be applied later in the file than earlier hunks.
     *
     * If a hunk cannot be successfully fitted *anywhere* with fewer than `fuzzFactor` mismatches, `applyPatch` fails and returns `false`.
     *
     * If a hunk is successfully fitted but not at the line number specified by the hunk header, all subsequent hunks have their target line number adjusted accordingly.
     * (e.g. if the first hunk is applied 10 lines below where the hunk header said it should fit, `applyPatch` will *start* looking for somewhere to apply the second hunk 10 lines below where its hunk header says it goes.)
     *
     * If the patch was applied successfully, returns a string containing the patched text.
     * If the patch could not be applied (because some hunks in the patch couldn't be fitted to the text in `source`), `applyPatch` returns false.
     *
     * @param patch a string diff or the output from the `parsePatch` or `structuredPatch` methods.
     */
    function applyPatch(source, patch, options = {}) {
        let patches;
        if (typeof patch === 'string') {
            patches = parsePatch(patch);
        }
        else if (Array.isArray(patch)) {
            patches = patch;
        }
        else {
            patches = [patch];
        }
        if (patches.length > 1) {
            throw new Error('applyPatch only works with a single input.');
        }
        return applyStructuredPatch(source, patches[0], options);
    }
    function applyStructuredPatch(source, patch, options = {}) {
        if (options.autoConvertLineEndings || options.autoConvertLineEndings == null) {
            if (hasOnlyWinLineEndings(source) && isUnix(patch)) {
                patch = unixToWin(patch);
            }
            else if (hasOnlyUnixLineEndings(source) && isWin(patch)) {
                patch = winToUnix(patch);
            }
        }
        // Apply the diff to the input
        const lines = source.split('\n'), hunks = patch.hunks, compareLine = options.compareLine || ((lineNumber, line, operation, patchContent) => line === patchContent), fuzzFactor = options.fuzzFactor || 0;
        let minLine = 0;
        if (fuzzFactor < 0 || !Number.isInteger(fuzzFactor)) {
            throw new Error('fuzzFactor must be a non-negative integer');
        }
        // Special case for empty patch.
        if (!hunks.length) {
            return source;
        }
        // Before anything else, handle EOFNL insertion/removal. If the patch tells us to make a change
        // to the EOFNL that is redundant/impossible - i.e. to remove a newline that's not there, or add a
        // newline that already exists - then we either return false and fail to apply the patch (if
        // fuzzFactor is 0) or simply ignore the problem and do nothing (if fuzzFactor is >0).
        // If we do need to remove/add a newline at EOF, this will always be in the final hunk:
        let prevLine = '', removeEOFNL = false, addEOFNL = false;
        for (let i = 0; i < hunks[hunks.length - 1].lines.length; i++) {
            const line = hunks[hunks.length - 1].lines[i];
            if (line[0] == '\\') {
                if (prevLine[0] == '+') {
                    removeEOFNL = true;
                }
                else if (prevLine[0] == '-') {
                    addEOFNL = true;
                }
            }
            prevLine = line;
        }
        if (removeEOFNL) {
            if (addEOFNL) {
                // This means the final line gets changed but doesn't have a trailing newline in either the
                // original or patched version. In that case, we do nothing if fuzzFactor > 0, and if
                // fuzzFactor is 0, we simply validate that the source file has no trailing newline.
                if (!fuzzFactor && lines[lines.length - 1] == '') {
                    return false;
                }
            }
            else if (lines[lines.length - 1] == '') {
                lines.pop();
            }
            else if (!fuzzFactor) {
                return false;
            }
        }
        else if (addEOFNL) {
            if (lines[lines.length - 1] != '') {
                lines.push('');
            }
            else if (!fuzzFactor) {
                return false;
            }
        }
        /**
         * Checks if the hunk can be made to fit at the provided location with at most `maxErrors`
         * insertions, substitutions, or deletions, while ensuring also that:
         * - lines deleted in the hunk match exactly, and
         * - wherever an insertion operation or block of insertion operations appears in the hunk, the
         *   immediately preceding and following lines of context match exactly
         *
         * `toPos` should be set such that lines[toPos] is meant to match hunkLines[0].
         *
         * If the hunk can be applied, returns an object with properties `oldLineLastI` and
         * `replacementLines`. Otherwise, returns null.
         */
        function applyHunk(hunkLines, toPos, maxErrors, hunkLinesI = 0, lastContextLineMatched = true, patchedLines = [], patchedLinesLength = 0) {
            let nConsecutiveOldContextLines = 0;
            let nextContextLineMustMatch = false;
            for (; hunkLinesI < hunkLines.length; hunkLinesI++) {
                const hunkLine = hunkLines[hunkLinesI], operation = (hunkLine.length > 0 ? hunkLine[0] : ' '), content = (hunkLine.length > 0 ? hunkLine.substr(1) : hunkLine);
                if (operation === '-') {
                    if (compareLine(toPos + 1, lines[toPos], operation, content)) {
                        toPos++;
                        nConsecutiveOldContextLines = 0;
                    }
                    else {
                        if (!maxErrors || lines[toPos] == null) {
                            return null;
                        }
                        patchedLines[patchedLinesLength] = lines[toPos];
                        return applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1);
                    }
                }
                if (operation === '+') {
                    if (!lastContextLineMatched) {
                        return null;
                    }
                    patchedLines[patchedLinesLength] = content;
                    patchedLinesLength++;
                    nConsecutiveOldContextLines = 0;
                    nextContextLineMustMatch = true;
                }
                if (operation === ' ') {
                    nConsecutiveOldContextLines++;
                    patchedLines[patchedLinesLength] = lines[toPos];
                    if (compareLine(toPos + 1, lines[toPos], operation, content)) {
                        patchedLinesLength++;
                        lastContextLineMatched = true;
                        nextContextLineMustMatch = false;
                        toPos++;
                    }
                    else {
                        if (nextContextLineMustMatch || !maxErrors) {
                            return null;
                        }
                        // Consider 3 possibilities in sequence:
                        // 1. lines contains a *substitution* not included in the patch context, or
                        // 2. lines contains an *insertion* not included in the patch context, or
                        // 3. lines contains a *deletion* not included in the patch context
                        // The first two options are of course only possible if the line from lines is non-null -
                        // i.e. only option 3 is possible if we've overrun the end of the old file.
                        return (lines[toPos] && (applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength + 1) || applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1)) || applyHunk(hunkLines, toPos, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength));
                    }
                }
            }
            // Before returning, trim any unmodified context lines off the end of patchedLines and reduce
            // toPos (and thus oldLineLastI) accordingly. This allows later hunks to be applied to a region
            // that starts in this hunk's trailing context.
            patchedLinesLength -= nConsecutiveOldContextLines;
            toPos -= nConsecutiveOldContextLines;
            patchedLines.length = patchedLinesLength;
            return {
                patchedLines,
                oldLineLastI: toPos - 1
            };
        }
        const resultLines = [];
        // Search best fit offsets for each hunk based on the previous ones
        let prevHunkOffset = 0;
        for (let i = 0; i < hunks.length; i++) {
            const hunk = hunks[i];
            let hunkResult;
            const maxLine = lines.length - hunk.oldLines + fuzzFactor;
            let toPos;
            for (let maxErrors = 0; maxErrors <= fuzzFactor; maxErrors++) {
                toPos = hunk.oldStart + prevHunkOffset - 1;
                const iterator = distanceIterator(toPos, minLine, maxLine);
                for (; toPos !== undefined; toPos = iterator()) {
                    hunkResult = applyHunk(hunk.lines, toPos, maxErrors);
                    if (hunkResult) {
                        break;
                    }
                }
                if (hunkResult) {
                    break;
                }
            }
            if (!hunkResult) {
                return false;
            }
            // Copy everything from the end of where we applied the last hunk to the start of this hunk
            for (let i = minLine; i < toPos; i++) {
                resultLines.push(lines[i]);
            }
            // Add the lines produced by applying the hunk:
            for (let i = 0; i < hunkResult.patchedLines.length; i++) {
                const line = hunkResult.patchedLines[i];
                resultLines.push(line);
            }
            // Set lower text limit to end of the current hunk, so next ones don't try
            // to fit over already patched text
            minLine = hunkResult.oldLineLastI + 1;
            // Note the offset between where the patch said the hunk should've applied and where we
            // applied it, so we can adjust future hunks accordingly:
            prevHunkOffset = toPos + 1 - hunk.oldStart;
        }
        // Copy over the rest of the lines from the old text
        for (let i = minLine; i < lines.length; i++) {
            resultLines.push(lines[i]);
        }
        return resultLines.join('\n');
    }
    /**
     * applies one or more patches.
     *
     * `patch` may be either an array of structured patch objects, or a string representing a patch in unified diff format (which may patch one or more files).
     *
     * This method will iterate over the contents of the patch and apply to data provided through callbacks. The general flow for each patch index is:
     *
     * - `options.loadFile(index, callback)` is called. The caller should then load the contents of the file and then pass that to the `callback(err, data)` callback. Passing an `err` will terminate further patch execution.
     * - `options.patched(index, content, callback)` is called once the patch has been applied. `content` will be the return value from `applyPatch`. When it's ready, the caller should call `callback(err)` callback. Passing an `err` will terminate further patch execution.
     *
     * Once all patches have been applied or an error occurs, the `options.complete(err)` callback is made.
     */
    function applyPatches(uniDiff, options) {
        const spDiff = typeof uniDiff === 'string' ? parsePatch(uniDiff) : uniDiff;
        let currentIndex = 0;
        function processIndex() {
            const index = spDiff[currentIndex++];
            if (!index) {
                return options.complete();
            }
            options.loadFile(index, function (err, data) {
                if (err) {
                    return options.complete(err);
                }
                const updatedContent = applyPatch(data, index, options);
                options.patched(index, updatedContent, function (err) {
                    if (err) {
                        return options.complete(err);
                    }
                    processIndex();
                });
            });
        }
        processIndex();
    }

    function swapPrefix(fileName) {
        if (fileName === undefined || fileName === '/dev/null') {
            return fileName;
        }
        if (fileName.startsWith('a/')) {
            return 'b/' + fileName.slice(2);
        }
        if (fileName.startsWith('b/')) {
            return 'a/' + fileName.slice(2);
        }
        return fileName;
    }
    function reversePatch(structuredPatch) {
        if (Array.isArray(structuredPatch)) {
            // (See comment in unixToWin for why we need the pointless-looking anonymous function here)
            return structuredPatch.map(patch => reversePatch(patch)).reverse();
        }
        const reversed = Object.assign(Object.assign({}, structuredPatch), { oldFileName: structuredPatch.isGit ? swapPrefix(structuredPatch.newFileName) : structuredPatch.newFileName, oldHeader: structuredPatch.newHeader, newFileName: structuredPatch.isGit ? swapPrefix(structuredPatch.oldFileName) : structuredPatch.oldFileName, newHeader: structuredPatch.oldHeader, oldMode: structuredPatch.newMode, newMode: structuredPatch.oldMode, isCreate: structuredPatch.isDelete, isDelete: structuredPatch.isCreate, hunks: structuredPatch.hunks.map(hunk => {
                return {
                    oldLines: hunk.newLines,
                    oldStart: hunk.newStart,
                    newLines: hunk.oldLines,
                    newStart: hunk.oldStart,
                    lines: hunk.lines.map(l => {
                        if (l.startsWith('-')) {
                            return `+${l.slice(1)}`;
                        }
                        if (l.startsWith('+')) {
                            return `-${l.slice(1)}`;
                        }
                        return l;
                    })
                };
            }) });
        if (structuredPatch.isCopy) {
            // Reversing a copy means deleting the file that was created by the copy.
            // The "old" file in the reversed patch is the copy destination (which
            // exists and should be removed), and the "new" file is /dev/null.
            //
            // Note: we clear the hunks because the original copy's hunks describe
            // the diff between the source and destination, not the full content of
            // the destination file, so they can't be meaningfully reversed into a
            // deletion hunk. This means the resulting patch is not something
            // `git apply` will accept (it requires deletion patches to include a
            // hunk removing every line). Producing a correct deletion hunk would
            // require knowing the full content of the copy destination, which we
            // don't have. Consumers that need a `git apply`-compatible patch will
            // need to resolve the full file content themselves.
            reversed.newFileName = '/dev/null';
            reversed.newHeader = undefined;
            reversed.isDelete = true;
            delete reversed.isCreate;
            delete reversed.isCopy;
            delete reversed.isRename;
            reversed.hunks = [];
        }
        // Reversing a rename is just a rename in the opposite direction;
        // isRename stays set and the filenames are already swapped above.
        return reversed;
    }

    /**
     * Returns true if the filename contains characters that require C-style
     * quoting (as used by Git and GNU diffutils in diff output).
     */
    function needsQuoting(s) {
        for (let i = 0; i < s.length; i++) {
            if (s[i] < '\x20' || s[i] > '\x7e' || s[i] === '"' || s[i] === '\\') {
                return true;
            }
        }
        return false;
    }
    /**
     * C-style quotes a filename, encoding special characters as escape sequences
     * and non-ASCII bytes as octal escapes. This is the inverse of
     * `parseQuotedFileName` in parse.ts.
     *
     * Non-ASCII bytes are encoded as UTF-8 before being emitted as octal escapes.
     * This matches the behaviour of both Git and GNU diffutils, which always emit
     * UTF-8 octal escapes regardless of the underlying filesystem encoding (e.g.
     * Git for Windows converts from NTFS's UTF-16 to UTF-8 internally).
     *
     * If the filename doesn't need quoting, returns it as-is.
     */
    function quoteFileNameIfNeeded(s) {
        if (!needsQuoting(s)) {
            return s;
        }
        let result = '"';
        const bytes = new TextEncoder().encode(s);
        let i = 0;
        while (i < bytes.length) {
            const b = bytes[i];
            // See https://en.wikipedia.org/wiki/Escape_sequences_in_C#Escape_sequences
            if (b === 0x07) {
                result += '\\a';
            }
            else if (b === 0x08) {
                result += '\\b';
            }
            else if (b === 0x09) {
                result += '\\t';
            }
            else if (b === 0x0a) {
                result += '\\n';
            }
            else if (b === 0x0b) {
                result += '\\v';
            }
            else if (b === 0x0c) {
                result += '\\f';
            }
            else if (b === 0x0d) {
                result += '\\r';
            }
            else if (b === 0x22) {
                result += '\\"';
            }
            else if (b === 0x5c) {
                result += '\\\\';
            }
            else if (b >= 0x20 && b <= 0x7e) {
                // Just a printable ASCII character that is neither a double quote nor a
                // backslash; no need to escape it.
                result += String.fromCharCode(b);
            }
            else {
                // Either part of a non-ASCII character or a control character without a
                // special escape sequence; needs escaping as a 3-digit octal escape
                result += '\\' + b.toString(8).padStart(3, '0');
            }
            i++;
        }
        result += '"';
        return result;
    }
    const INCLUDE_HEADERS = {
        includeIndex: true,
        includeUnderline: true,
        includeFileHeaders: true
    };
    const FILE_HEADERS_ONLY = {
        includeIndex: false,
        includeUnderline: false,
        includeFileHeaders: true
    };
    const OMIT_HEADERS = {
        includeIndex: false,
        includeUnderline: false,
        includeFileHeaders: false
    };
    function structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
        let optionsObj;
        if (!options) {
            optionsObj = {};
        }
        else if (typeof options === 'function') {
            optionsObj = { callback: options };
        }
        else {
            optionsObj = options;
        }
        if (typeof optionsObj.context === 'undefined') {
            optionsObj.context = 4;
        }
        // We copy this into its own variable to placate TypeScript, which thinks
        // optionsObj.context might be undefined in the callbacks below.
        const context = optionsObj.context;
        // @ts-expect-error (runtime check for something that is correctly a static type error)
        if (optionsObj.newlineIsToken) {
            throw new Error('newlineIsToken may not be used with patch-generation functions, only with diffing functions');
        }
        if (!optionsObj.callback) {
            return diffLinesResultToPatch(diffLines(oldStr, newStr, optionsObj));
        }
        else {
            const { callback } = optionsObj;
            diffLines(oldStr, newStr, Object.assign(Object.assign({}, optionsObj), { callback: (diff) => {
                    const patch = diffLinesResultToPatch(diff);
                    // TypeScript is unhappy without the cast because it does not understand that `patch` may
                    // be undefined here only if `callback` is StructuredPatchCallbackAbortable:
                    callback(patch);
                } }));
        }
        function diffLinesResultToPatch(diff) {
            // STEP 1: Build up the patch with no "\ No newline at end of file" lines and with the arrays
            //         of lines containing trailing newline characters. We'll tidy up later...
            if (!diff) {
                return;
            }
            diff.push({ value: '', lines: [] }); // Append an empty value to make cleanup easier
            function contextLines(lines) {
                return lines.map(function (entry) { return ' ' + entry; });
            }
            const hunks = [];
            let oldRangeStart = 0, newRangeStart = 0, curRange = [], oldLine = 1, newLine = 1;
            for (let i = 0; i < diff.length; i++) {
                const current = diff[i], lines = current.lines || splitLines(current.value);
                current.lines = lines;
                if (current.added || current.removed) {
                    // If we have previous context, start with that
                    if (!oldRangeStart) {
                        const prev = diff[i - 1];
                        oldRangeStart = oldLine;
                        newRangeStart = newLine;
                        if (prev) {
                            curRange = context > 0 ? contextLines(prev.lines.slice(-context)) : [];
                            oldRangeStart -= curRange.length;
                            newRangeStart -= curRange.length;
                        }
                    }
                    // Output our changes
                    for (const line of lines) {
                        curRange.push((current.added ? '+' : '-') + line);
                    }
                    // Track the updated file position
                    if (current.added) {
                        newLine += lines.length;
                    }
                    else {
                        oldLine += lines.length;
                    }
                }
                else {
                    // Identical context lines. Track line changes
                    if (oldRangeStart) {
                        // Close out any changes that have been output (or join overlapping)
                        if (lines.length <= context * 2 && i < diff.length - 2) {
                            // Overlapping
                            for (const line of contextLines(lines)) {
                                curRange.push(line);
                            }
                        }
                        else {
                            // end the range and output
                            const contextSize = Math.min(lines.length, context);
                            for (const line of contextLines(lines.slice(0, contextSize))) {
                                curRange.push(line);
                            }
                            const hunk = {
                                oldStart: oldRangeStart,
                                oldLines: (oldLine - oldRangeStart + contextSize),
                                newStart: newRangeStart,
                                newLines: (newLine - newRangeStart + contextSize),
                                lines: curRange
                            };
                            hunks.push(hunk);
                            oldRangeStart = 0;
                            newRangeStart = 0;
                            curRange = [];
                        }
                    }
                    oldLine += lines.length;
                    newLine += lines.length;
                }
            }
            // Step 2: eliminate the trailing `\n` from each line of each hunk, and, where needed, add
            //         "\ No newline at end of file".
            for (const hunk of hunks) {
                for (let i = 0; i < hunk.lines.length; i++) {
                    if (hunk.lines[i].endsWith('\n')) {
                        hunk.lines[i] = hunk.lines[i].slice(0, -1);
                    }
                    else {
                        hunk.lines.splice(i + 1, 0, '\\ No newline at end of file');
                        i++; // Skip the line we just added, then continue iterating
                    }
                }
            }
            return {
                oldFileName: oldFileName, newFileName: newFileName,
                oldHeader: oldHeader, newHeader: newHeader,
                hunks: hunks
            };
        }
    }
    /**
     * creates a unified diff patch.
     *
     * @param patch either a single structured patch object (as returned by `structuredPatch`) or an
     *   array of them (as returned by `parsePatch`).
     * @param headerOptions behaves the same as the `headerOptions` option of `createTwoFilesPatch`.
     *   Ignored for patches where `isGit` is `true`.
     *
     * When a patch has `isGit: true`, `formatPatch` output is changed to more closely match Git's
     * output: it emits a `diff --git` header, emits Git extended headers as appropriate based on
     * properties like `isRename`, `isCreate`, `newMode`, etc, and will omit `---`/`+++` file
     * headers for patches with no hunks (e.g. renames without content changes).
     */
    function formatPatch(patch, headerOptions) {
        var _a, _b, _c, _d, _e, _f;
        if (!headerOptions) {
            headerOptions = INCLUDE_HEADERS;
        }
        if (Array.isArray(patch)) {
            if (patch.length > 1 && !headerOptions.includeFileHeaders && !patch.every(p => p.isGit)) {
                throw new Error('Cannot omit file headers on a multi-file patch. '
                    + '(The result would be unparseable; how would a tool trying to apply '
                    + 'the patch know which changes are to which file?)');
            }
            return patch.map(p => formatPatch(p, headerOptions)).join('\n');
        }
        const ret = [];
        // Git patches have a fixed header format (diff --git, extended headers,
        // and ---/+++ when hunks are present), so headerOptions is ignored.
        if (patch.isGit) {
            headerOptions = INCLUDE_HEADERS;
            // Emit Git-style diff --git header and extended headers.
            // Git never puts /dev/null in the "diff --git" line; for file
            // creations/deletions it uses the real filename on both sides.
            if (!patch.oldFileName) {
                throw new Error('oldFileName must be specified for Git patches');
            }
            if (!patch.newFileName) {
                throw new Error('newFileName must be specified for Git patches');
            }
            let gitOldName = patch.oldFileName;
            let gitNewName = patch.newFileName;
            if (patch.isCreate && gitOldName === '/dev/null') {
                gitOldName = gitNewName.replace(/^b\//, 'a/');
            }
            else if (patch.isDelete && gitNewName === '/dev/null') {
                gitNewName = gitOldName.replace(/^a\//, 'b/');
            }
            ret.push('diff --git ' + quoteFileNameIfNeeded(gitOldName) + ' ' + quoteFileNameIfNeeded(gitNewName));
            if (patch.isDelete) {
                ret.push('deleted file mode ' + ((_a = patch.oldMode) !== null && _a !== void 0 ? _a : '100644'));
            }
            if (patch.isCreate) {
                ret.push('new file mode ' + ((_b = patch.newMode) !== null && _b !== void 0 ? _b : '100644'));
            }
            if (patch.oldMode && patch.newMode && !patch.isDelete && !patch.isCreate) {
                ret.push('old mode ' + patch.oldMode);
                ret.push('new mode ' + patch.newMode);
            }
            if (patch.isRename) {
                ret.push('rename from ' + quoteFileNameIfNeeded(((_c = patch.oldFileName) !== null && _c !== void 0 ? _c : '').replace(/^a\//, '')));
                ret.push('rename to ' + quoteFileNameIfNeeded(((_d = patch.newFileName) !== null && _d !== void 0 ? _d : '').replace(/^b\//, '')));
            }
            if (patch.isCopy) {
                ret.push('copy from ' + quoteFileNameIfNeeded(((_e = patch.oldFileName) !== null && _e !== void 0 ? _e : '').replace(/^a\//, '')));
                ret.push('copy to ' + quoteFileNameIfNeeded(((_f = patch.newFileName) !== null && _f !== void 0 ? _f : '').replace(/^b\//, '')));
            }
        }
        else {
            if (headerOptions.includeIndex && patch.oldFileName == patch.newFileName && patch.oldFileName !== undefined) {
                ret.push('Index: ' + patch.oldFileName);
            }
            if (headerOptions.includeUnderline) {
                ret.push('===================================================================');
            }
        }
        // Emit --- / +++ file headers. For Git patches with no hunks (e.g.
        // pure renames, mode-only changes), Git omits these, so we do too.
        const hasHunks = patch.hunks.length > 0;
        if (headerOptions.includeFileHeaders && patch.oldFileName !== undefined && patch.newFileName !== undefined
            && (!patch.isGit || hasHunks)) {
            ret.push('--- ' + quoteFileNameIfNeeded(patch.oldFileName) + (patch.oldHeader ? '\t' + patch.oldHeader : ''));
            ret.push('+++ ' + quoteFileNameIfNeeded(patch.newFileName) + (patch.newHeader ? '\t' + patch.newHeader : ''));
        }
        for (let i = 0; i < patch.hunks.length; i++) {
            const hunk = patch.hunks[i];
            // Unified Diff Format quirk: If the chunk size is 0,
            // the first number is one lower than one would expect.
            // https://www.artima.com/weblogs/viewpost.jsp?thread=164293
            const oldStart = hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart;
            const newStart = hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart;
            ret.push('@@ -' + oldStart + ',' + hunk.oldLines
                + ' +' + newStart + ',' + hunk.newLines
                + ' @@');
            for (const line of hunk.lines) {
                ret.push(line);
            }
        }
        return ret.join('\n') + '\n';
    }
    function createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
        if (typeof options === 'function') {
            options = { callback: options };
        }
        if (!(options === null || options === void 0 ? void 0 : options.callback)) {
            const patchObj = structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options);
            if (!patchObj) {
                return;
            }
            return formatPatch(patchObj, options === null || options === void 0 ? void 0 : options.headerOptions);
        }
        else {
            const { callback } = options;
            structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, Object.assign(Object.assign({}, options), { callback: patchObj => {
                    if (!patchObj) {
                        callback(undefined);
                    }
                    else {
                        callback(formatPatch(patchObj, options.headerOptions));
                    }
                } }));
        }
    }
    function createPatch(fileName, oldStr, newStr, oldHeader, newHeader, options) {
        return createTwoFilesPatch(fileName, fileName, oldStr, newStr, oldHeader, newHeader, options);
    }
    /**
     * Split `text` into an array of lines, including the trailing newline character (where present)
     */
    function splitLines(text) {
        const hasTrailingNl = text.endsWith('\n');
        const result = text.split('\n').map(line => line + '\n');
        if (hasTrailingNl) {
            result.pop();
        }
        else {
            result.push(result.pop().slice(0, -1));
        }
        return result;
    }

    /**
     * converts a list of change objects to the format returned by Google's [diff-match-patch](https://github.com/google/diff-match-patch) library
     */
    function convertChangesToDMP(changes) {
        const ret = [];
        let change, operation;
        for (let i = 0; i < changes.length; i++) {
            change = changes[i];
            if (change.added) {
                operation = 1;
            }
            else if (change.removed) {
                operation = -1;
            }
            else {
                operation = 0;
            }
            ret.push([operation, change.value]);
        }
        return ret;
    }

    /**
     * converts a list of change objects to a serialized XML format
     */
    function convertChangesToXML(changes) {
        const ret = [];
        for (let i = 0; i < changes.length; i++) {
            const change = changes[i];
            if (change.added) {
                ret.push('<ins>');
            }
            else if (change.removed) {
                ret.push('<del>');
            }
            ret.push(escapeHTML(change.value));
            if (change.added) {
                ret.push('</ins>');
            }
            else if (change.removed) {
                ret.push('</del>');
            }
        }
        return ret.join('');
    }
    function escapeHTML(s) {
        let n = s;
        n = n.replace(/&/g, '&amp;');
        n = n.replace(/</g, '&lt;');
        n = n.replace(/>/g, '&gt;');
        n = n.replace(/"/g, '&quot;');
        return n;
    }

    exports.Diff = Diff;
    exports.FILE_HEADERS_ONLY = FILE_HEADERS_ONLY;
    exports.INCLUDE_HEADERS = INCLUDE_HEADERS;
    exports.OMIT_HEADERS = OMIT_HEADERS;
    exports.applyPatch = applyPatch;
    exports.applyPatches = applyPatches;
    exports.arrayDiff = arrayDiff;
    exports.canonicalize = canonicalize;
    exports.characterDiff = characterDiff;
    exports.convertChangesToDMP = convertChangesToDMP;
    exports.convertChangesToXML = convertChangesToXML;
    exports.createPatch = createPatch;
    exports.createTwoFilesPatch = createTwoFilesPatch;
    exports.cssDiff = cssDiff;
    exports.diffArrays = diffArrays;
    exports.diffChars = diffChars;
    exports.diffCss = diffCss;
    exports.diffJson = diffJson;
    exports.diffLines = diffLines;
    exports.diffSentences = diffSentences;
    exports.diffTrimmedLines = diffTrimmedLines;
    exports.diffWords = diffWords;
    exports.diffWordsWithSpace = diffWordsWithSpace;
    exports.formatPatch = formatPatch;
    exports.jsonDiff = jsonDiff;
    exports.lineDiff = lineDiff;
    exports.parsePatch = parsePatch;
    exports.reversePatch = reversePatch;
    exports.sentenceDiff = sentenceDiff;
    exports.structuredPatch = structuredPatch;
    exports.wordDiff = wordDiff;
    exports.wordsWithSpaceDiff = wordsWithSpaceDiff;

}));

    return module.exports
  })()
  const diffEngine = (() => {
const { diffArrays, diffChars } = diffLibrary

/**
 * 与渲染器无关的差异片段，分别表示保留、新增和删除。
 * @typedef {{ type: 'equal' | 'insert' | 'delete', text: string }} DiffSegment
 */

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-Hans', { granularity: 'word' }) : null

function normalizeChanges(changes, join = value => value) {
  return changes.map(change => ({
    type: change.added ? 'insert' : change.removed ? 'delete' : 'equal',
    text: join(change.value)
  })).filter(segment => segment.text.length > 0)
}

function statistics(segments) {
  const stats = { equalChars: 0, insertedChars: 0, deletedChars: 0, changeRatio: 0 }
  for (const segment of segments) {
    const field = segment.type === 'equal' ? 'equalChars' : segment.type === 'insert' ? 'insertedChars' : 'deletedChars'
    stats[field] += segment.text.length
  }
  const changed = stats.insertedChars + stats.deletedChars
  // 保留文字在原文和结果中各计一次，增删文字分别计入变化量。
  stats.changeRatio = changed / (2 * stats.equalChars + changed || 1)
  return stats
}

function classifyDiffMagnitude(stats, originalLength, resultLength) {
  if (!originalLength || !resultLength) return 'inline'
  // 扩写或缩写保留了较短文本的大部分内容时，仍显示局部差异。
  if (stats.equalChars / Math.min(originalLength, resultLength) >= 0.5) return 'inline'
  const longest = Math.max(originalLength, resultLength)
  const changed = stats.insertedChars + stats.deletedChars
  return longest >= 12 && (stats.equalChars / longest < 0.35 || changed > stats.equalChars * 3)
    ? 'block-replace' : 'inline'
}

function wholeBlock(original, result) {
  return [
    ...(original ? [{ type: 'delete', text: original }] : []),
    ...(result ? [{ type: 'insert', text: result }] : [])
  ]
}

function refineSmallReplacements(segments) {
  const refined = []
  for (let index = 0; index < segments.length; index++) {
    const removed = segments[index]
    const added = segments[index + 1]
    if (removed.type === 'delete' && added?.type === 'insert' &&
      Math.max(removed.text.length, added.text.length) <= 12 &&
      Math.max(removed.text.length, added.text.length) <= Math.min(removed.text.length, added.text.length) * 3) {
      const local = normalizeChanges(diffChars(removed.text, added.text))
      // 中文替换块仅保留少量共同汉字时，不拆成零碎的字符差异。
      const retained = statistics(local).equalChars
      const hasHan = /\p{Script=Han}/u.test(removed.text + added.text)
      const pureChange = !local.some(segment => segment.type === 'delete') || !local.some(segment => segment.type === 'insert')
      if (!hasHan || pureChange || retained / Math.max(removed.text.length, added.text.length) >= 0.5) refined.push(...local)
      else refined.push(removed, added)
      index++
    } else refined.push(removed)
  }
  // 局部细化后合并相邻的同类片段。
  const merged = []
  for (const segment of refined) {
    const last = merged.at(-1)
    if (last?.type === segment.type) last.text += segment.text
    else merged.push({ ...segment })
  }
  return merged
}

/** 以中文词级差异为主，仅细化短替换块；超限、超时或碎片过多时整块降级。 */
function computeTextDiff(original, result, options = {}) {
  if (typeof original !== 'string' || typeof result !== 'string') {
    return { segments: [], stats: statistics([]), mode: 'inline', reason: 'invalid-text' }
  }
  if (original === result) {
    const segments = original ? [{ type: 'equal', text: original }] : []
    return { segments, stats: statistics(segments), mode: 'inline', reason: 'unchanged' }
  }
  const block = () => {
    const segments = wholeBlock(original, result)
    return { segments, stats: statistics(segments), mode: 'block-replace', reason: null }
  }
  if (Math.max(original.length, result.length) > (options.maxLength ?? 12000) || !segmenter) return block()
  if (!original || !result) {
    const segments = wholeBlock(original, result)
    return { segments, stats: statistics(segments), mode: 'inline', reason: null }
  }
  // 分词数组完整保留空格和换行，确保输入框的 UTF-16 坐标可准确累计。
  const tokenize = text => Array.from(segmenter.segment(text), item => item.segment)
  if ((options.diffTimeoutMs ?? 50) <= 0) return block()
  const changes = diffArrays(tokenize(original), tokenize(result), { timeout: options.diffTimeoutMs ?? 50 })
  if (!changes) return block()
  const segments = refineSmallReplacements(normalizeChanges(changes, value => value.join('')))
  const stats = statistics(segments)
  const mode = classifyDiffMagnitude(stats, original.length, result.length)
  const tooFragmented = segments.filter(segment => segment.type !== 'equal').length > (options.maxRanges ?? 40)
  // 展示降级时仍保留原始比较统计，用于说明实际改动幅度。
  return { segments: mode === 'block-replace' || tooFragmented ? wholeBlock(original, result) : segments,
    stats, mode: tooFragmented ? 'block-replace' : mode, reason: null }
}

function diffSegments(original, result, options = {}) {
  return computeTextDiff(original, result, options).segments
}

/** 将差异片段映射为原文和结果的 UTF-16 范围，供高亮渲染使用。 */
function segmentsToHunks(segments) {
  const hunks = []
  let originalOffset = 0
  let resultOffset = 0
  let current = null
  const flush = () => { if (current) hunks.push(current); current = null }
  for (const segment of segments) {
    if (segment.type === 'equal') {
      flush()
      originalOffset += segment.text.length
      resultOffset += segment.text.length
      continue
    }
    current ??= { add: null, rem: null }
    if (segment.type === 'delete') {
      current.rem ??= { start: originalOffset, end: originalOffset }
      // 删除只推进原文坐标；锚点表示删除内容在结果中的对应插入位置。
      current.resultAnchor ??= current.add?.start ?? resultOffset
      originalOffset += segment.text.length
      current.rem.end = originalOffset
    } else {
      current.add ??= { start: resultOffset, end: resultOffset }
      resultOffset += segment.text.length
      current.add.end = resultOffset
    }
  }
  flush()
  return hunks
}

function diffHunks(original, result, options = {}) {
  const diff = computeTextDiff(original, result, options)
  return { hunks: segmentsToHunks(diff.segments), reason: diff.reason, mode: diff.mode, stats: diff.stats }
}

function diffRanges(original, result, options = {}) {
  const diff = diffHunks(original, result, options)
  if (diff.reason) return { ranges: [], reason: diff.reason }
  const ranges = diff.hunks.filter(hunk => hunk.add !== null).map(hunk => hunk.add)
  return { ranges, reason: ranges.length ? null : 'no-visible-addition' }
}

    return { computeTextDiff, classifyDiffMagnitude, diffSegments, segmentsToHunks, diffHunks, diffRanges }
  })()
function assertString(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
}

/** Standalone refinement state; snapshots and generation history are immutable. */
class RefinementSession {
  #snapshot
  #listeners = new Set()
  #nextGenerationId = 1

  constructor() {
    this.#snapshot = Object.freeze({
      original: '',
      optimized: '',
      current: '',
      status: 'idle',
      revision: 0,
      generations: Object.freeze([]),
      hasResult: false,
      dirty: false
    })
  }

  get original() { return this.#snapshot.original }
  get optimized() { return this.#snapshot.optimized }
  get current() { return this.#snapshot.current }
  get status() { return this.#snapshot.status }
  get revision() { return this.#snapshot.revision }
  get generations() { return this.#snapshot.generations }
  get hasResult() { return this.#snapshot.hasResult }
  get dirty() { return this.#snapshot.dirty }

  getSnapshot() {
    return this.#snapshot
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  begin(original) {
    assertString(original, 'original')
    return this.#update({
      original,
      optimized: '',
      current: original,
      status: 'idle',
      generations: Object.freeze([]),
      hasResult: false
    })
  }

  applyGeneration(text) {
    assertString(text, 'text')
    const generation = Object.freeze({ id: this.#nextGenerationId++, text })
    return this.#update({
      optimized: text,
      current: text,
      status: 'reviewing',
      generations: Object.freeze([...this.generations, generation]),
      hasResult: true
    })
  }

  updateCurrent(text) {
    assertString(text, 'text')
    if (text === this.current) return this.#snapshot
    return this.#update({
      current: text,
      status: this.hasResult && text === this.optimized ? 'reviewing' : 'editing'
    })
  }

  clear() {
    return this.#update({
      original: '',
      optimized: '',
      current: '',
      status: 'idle',
      generations: Object.freeze([]),
      hasResult: false
    })
  }

  #update(changes) {
    const next = { ...this.#snapshot, ...changes, revision: this.revision + 1 }
    next.dirty = next.hasResult && next.current !== next.optimized
    const snapshot = Object.freeze(next)
    this.#snapshot = snapshot
    for (const listener of [...this.#listeners]) listener(snapshot)
    return snapshot
  }
}




/* DSH 浏览器客户端源码，由 build-client.js 生成延迟加载入口。 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-refine',
  factory: (require) => {
    const exports = {}
    const React = require('react')
    // 差异计算由 highlight-core.js 提供，此处负责高亮和输入框坐标映射。
    function createHighlightCore(options = {}) {
  const name = options.name && /^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(options.name)
    ? options.name : `dsh-prompt-refine-${Math.random().toString(36).slice(2)}`
  const diffHunks = (original, result) => diffEngine.diffHunks(original, result, options)
  const diffRanges = (original, result) => diffEngine.diffRanges(original, result, options)
  const diffSegments = (original, result) => diffEngine.diffSegments(original, result, options)
  let owner = null
  let status = { kind: 'none', reason: 'idle', count: 0 }

  /**
   * 合并相邻或仅由标点、空白分隔的范围，并剔除纯空白高亮。
   */
  function coalesceRanges(ranges, text, mergeGap = options.mergeGap ?? 2) {
    const merged = []
    for (const range of ranges) {
      const last = merged[merged.length - 1]
      if (last && (range.start - last.end <= mergeGap ||
        (range.start > last.end && !/[\p{L}\p{N}]/u.test(text.slice(last.end, range.start))))) {
        last.end = Math.max(last.end, range.end)
        continue
      }
      merged.push({ start: range.start, end: range.end })
    }
    // 去除范围边缘的空白，避免下划线跨越段落边界。
    return merged
      .map(range => {
        let { start, end } = range
        while (start < end && /\s/u.test(text[start])) start++
        while (end > start && /\s/u.test(text[end - 1])) end--
        return { start, end }
      })
      .filter(range => range.end > range.start)
  }

  // 检测坐标中每个引用只占一位；草稿文本中保留引用的完整剪贴板表示。
  function snapshotLayout(snapshot) {
    if (!snapshot || typeof snapshot.draft !== 'string' || !Array.isArray(snapshot.occurrences)) return null
    const chips = []
    let detect = ''
    let pos = 0
    for (const occ of snapshot.occurrences) {
      if (!occ || !Number.isSafeInteger(occ.offset) || !Number.isSafeInteger(occ.length) ||
        occ.offset < pos || occ.length < 1 || occ.offset + occ.length > snapshot.draft.length) return null
      const text = snapshot.draft.slice(occ.offset, occ.offset + occ.length)
      if (typeof occ.clipboardText === 'string' && occ.clipboardText !== text) return null
      detect += snapshot.draft.slice(pos, occ.offset)
      chips.push({ occ, start: detect.length, text })
      detect += '\uFFFC'
      pos = occ.offset + occ.length
    }
    detect += snapshot.draft.slice(pos)
    return { chips, detect }
  }

  function clipboardOffset(at, chips) {
    return at + chips.reduce((extra, chip) => extra + (chip.start + 1 <= at ? chip.occ.length - 1 : 0), 0)
  }

  function sameOccurrence(before, after, offset) {
    if (after.offset !== offset || after.length !== before.length) return false
    for (const key of ['occurrenceId', 'source', 'ref', 'label', 'clipboardText', 'appearance', 'invalid']) {
      if (before[key] !== after[key]) return false
    }
    return true
  }

  function detectSlice(snapshot, span) {
    const layout = snapshotLayout(snapshot)
    if (!layout || !span || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
      span.start < 0 || span.end < span.start || span.end > layout.detect.length ||
      layout.chips.some(chip => chip.start < span.end && chip.start + 1 > span.start)) return null
    const first = clipboardOffset(span.start, layout.chips)
    const last = clipboardOffset(span.end, layout.chips)
    return snapshot.draft.slice(first, last)
  }

  // 校验回填后的全文、版本和引用身份，确认范围映射仍与宿主一致。
  function expectedAfter(before, snapshot, replaced, result, start) {
    const previous = snapshotLayout(before)
    const current = snapshotLayout(snapshot)
    if (!previous || !current || !Number.isSafeInteger(start) || start < 0 ||
      start + replaced.length > previous.detect.length || result.includes('\uFFFC')) return null
    const end = start + replaced.length
    if (previous.chips.some(chip => chip.start < end && chip.start + 1 > start)) return null
    const first = clipboardOffset(start, previous.chips)
    const last = clipboardOffset(end, previous.chips)
    if (before.draft.slice(first, last) !== replaced || previous.detect.slice(start, end) !== replaced) return null
    if (snapshot.draft !== before.draft.slice(0, first) + result + before.draft.slice(last) ||
      current.detect !== previous.detect.slice(0, start) + result + previous.detect.slice(end) ||
      current.chips.length !== previous.chips.length) return null
    if (Number.isSafeInteger(before.draftRev) && Number.isSafeInteger(snapshot.draftRev) &&
      snapshot.draftRev < before.draftRev + (before.draft === snapshot.draft ? 0 : 1)) return null
    for (let k = 0; k < previous.chips.length; k++) {
      const old = previous.chips[k].occ
      const next = current.chips[k].occ
      const offset = old.offset + (old.offset >= last ? result.length - replaced.length : 0)
      if (!sameOccurrence(old, next, offset)) return null
    }
    return current
  }

  // 按 Lexical 的段落、文本和原子引用节点建立映射；遇到未知结构时放弃高亮。
  // 宿主管理的 BR/IMG 占位节点不计入正文，实际换行节点按换行符处理。
  function projectDom(root, layout) {
    if (!root || root.nodeType !== 1 || root.getAttribute?.('data-composer-input') === null) return null
    const paragraphs = Array.from(root.childNodes || [])
    if (!paragraphs.length || paragraphs.some(p => p.nodeType !== 1 || p.tagName?.toLowerCase() !== 'p')) return null
    let text = ''
    let clipboard = ''
    const runs = []
    let chipIndex = 0
    function walk(node) {
      if (node.nodeType === 3) {
        const value = node.data
        if (typeof value !== 'string') return false
        if (value.length) runs.push({ start: text.length, end: text.length + value.length, node })
        text += value
        clipboard += value
        return true
      }
      if (node.nodeType !== 1) return false
      const tag = node.tagName?.toLowerCase()
      if (node.getAttribute('data-composer-chip') !== null) {
        const chip = layout.chips[chipIndex++]
        if (!chip || node.getAttribute('contenteditable') !== 'false' ||
          node.getAttribute('data-composer-chip') !== chip.occ.source ||
          chip.start !== text.length) return false
        text += '\uFFFC'
        clipboard += chip.text
        return true
      }
      if ((tag === 'br' || tag === 'img') && node.getAttribute('data-lexical-managed-linebreak') === 'true') return true
      if (tag === 'br') { text += '\n'; clipboard += '\n'; return true }
      if (!['span', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'mark'].includes(tag)) return false
      for (const child of node.childNodes) if (!walk(child)) return false
      return true
    }
    for (let p = 0; p < paragraphs.length; p++) {
      if (p) { text += '\n'; clipboard += '\n' }
      for (const child of paragraphs[p].childNodes) if (!walk(child)) return null
    }
    return chipIndex === layout.chips.length && text === layout.detect && clipboard === layout.clipboard
      ? runs : null
  }

  function clear() {
    if (owner) {
      owner.observer?.disconnect()
      for (const key of owner.names) owner.css.highlights.delete(key)
      for (const style of owner.styles) style?.remove()
      owner = null
    }
    status = { kind: 'none', reason: 'cleared', count: 0, blocks: 0, replaced: 0, removed: 0 }
  }

  function fallback(reason) {
    clear()
    status = { kind: 'fallback', reason, count: 0, blocks: 0, replaced: 0, removed: 0 }
    return status
  }

  // 回填模式校验前后快照；实时模式只校验当前范围、快照与 DOM。
  function show({ root, before, snapshot, original, replaced = original, result, start, currentMode = false } = {}) {
    clear()
    // 纯删除没有可高亮的结果文字；红色标记表示替换后的文字。
    const walk = diffHunks(original, result)
    if (walk.reason === 'unchanged') return (status = { kind: 'none', reason: 'unchanged', count: 0, blocks: 0, replaced: 0, removed: 0 })
    if (walk.reason) return fallback(walk.reason)
    // 长度相近的就地替换标红；明显扩写按新增文字标绿。
    const colored = []
    for (const hunk of walk.hunks) {
      if (hunk.add === null) continue
      const added = result.slice(hunk.add.start, hunk.add.end)
      const removed = hunk.rem === null ? '' : original.slice(hunk.rem.start, hunk.rem.end)
      const swap = hunk.rem !== null && /\S/u.test(removed) &&
        added.length <= removed.length * (options.maxReplaceGrowth ?? 3) + (options.replaceSlack ?? 2)
      const color = swap ? 'red' : 'green'
      const last = colored[colored.length - 1]
      if (last?.color === color) last.ranges.push(hunk.add)
      else colored.push({ color, ranges: [hunk.add] })
    }
    // 分别合并两种颜色的范围，避免跨色覆盖。
    const colorSpans = (color) => colored.filter(group => group.color === color)
      .flatMap(group => coalesceRanges(group.ranges, result))
    if (typeof original !== 'string' || typeof replaced !== 'string' || typeof result !== 'string' || !root || !snapshot ||
      snapshot.draft.length > (options.maxDraftLength ?? 200000)) return fallback('invalid-input')
    if (!currentMode && before?.draft === snapshot.draft && before?.draftRev === snapshot.draftRev && replaced === result) {
      return (status = { kind: 'none', reason: 'already-applied', count: 0, blocks: 0, replaced: 0 })
    }
    const layout = currentMode
      ? (detectSlice(snapshot, { start, end: start + result.length }) === result ? snapshotLayout(snapshot) : null)
      : expectedAfter(before, snapshot, replaced, result, start)
    if (!layout) return fallback('draft-mismatch')
    layout.clipboard = snapshot.draft
    const runs = projectDom(root, layout)
    if (!runs) return fallback('dom-mismatch')
    const doc = root.ownerDocument
    const view = doc?.defaultView
    const css = options.css ?? view?.CSS
    const HighlightCtor = options.Highlight ?? view?.Highlight
    if (!doc?.createRange || !doc?.createElement || !doc?.head?.appendChild ||
      !css?.highlights?.set || !css?.highlights?.delete || typeof HighlightCtor !== 'function') return fallback('unsupported')
    // 将结果坐标裁剪到真实文本节点，跨段落范围拆成多个 DOM Range。
    const toDomRanges = (spans) => {
      const built = []
      for (const span of spans) {
        const startAt = start + span.start
        const endAt = start + span.end
        for (const run of runs) {
          const left = Math.max(startAt, run.start)
          const right = Math.min(endAt, run.end)
          if (left >= right) continue
          try {
            const range = doc.createRange()
            range.setStart(run.node, left - run.start)
            range.setEnd(run.node, right - run.start)
            built.push(range)
          } catch { return null }
        }
      }
      return built
    }
    const greenSpans = colorSpans('green')
    const redSpans = colorSpans('red')
    const meaningful = (range) => /[\p{L}\p{N}]/u.test(result.slice(range.start, range.end))
    const hasMeaningful = [...greenSpans, ...redSpans].some(meaningful)
    const chosenGreen = hasMeaningful ? greenSpans.filter(meaningful) : greenSpans
    const chosenRed = hasMeaningful ? redSpans.filter(meaningful) : redSpans
    const wordRanges = toDomRanges(chosenGreen)
    const redRanges = toDomRanges(chosenRed)
    if (wordRanges === null || redRanges === null) return fallback('range-error')
    if (!wordRanges.length && !redRanges.length) return fallback('nontext-only')
    // CSS 高亮只装饰已有结果文字，不修改编辑器内容。
    const wordCss = options.wordCss ?? `::highlight(${name}) { background-color: rgba(61, 214, 140, 0.16); color: inherit; text-decoration: underline dashed #3DD68C; text-underline-offset: 2px; }`
    const redCss = options.redCss ?? `::highlight(${name}-del) { background-color: rgba(224, 82, 74, 0.16); color: inherit; text-decoration: underline dashed #E0524A; text-underline-offset: 2px; }`
    const ownerState = { css, root, expectedDraft: snapshot.draft, expectedRev: snapshot.draftRev,
      observer: null, names: [], styles: [] }
    const paint = (key, cssText, ranges) => {
      const highlight = new HighlightCtor(...ranges)
      const style = doc.createElement('style')
      style.textContent = cssText
      doc.head.appendChild(style)
      css.highlights.set(key, highlight)
      ownerState.names.push(key)
      ownerState.styles.push(style)
    }
    try {
      if (wordRanges.length) paint(name, wordCss, wordRanges)
      if (redRanges.length) paint(`${name}-del`, redCss, redRanges)
      owner = ownerState
      const Observer = options.MutationObserver ?? view?.MutationObserver
      if (!options.managed && typeof Observer === 'function') {
        owner.observer = new Observer(() => {
          clear()
          options.onInvalidate?.()
        })
        owner.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
      }
    } catch {
      for (const key of ownerState.names) css.highlights.delete(key)
      for (const style of ownerState.styles) style?.remove()
      return fallback('highlight-error')
    }
    // 以整个结果草稿为分母计算高亮比例，供状态栏说明改动幅度。
    return (status = { kind: 'highlighted', reason: null, count: wordRanges.length, blocks: 0,
      replaced: redRanges.length, removed: walk.hunks.filter(hunk => hunk.rem !== null).length,
      coverage: [...chosenGreen, ...chosenRed].reduce((total, range) => total + (range.end - range.start), 0) / (snapshot.draft.length || 1) })
  }

  function check({ root, snapshot } = {}) {
    if (!owner) return status
    if (root !== owner.root || snapshot?.draft !== owner.expectedDraft ||
      snapshot?.draftRev !== owner.expectedRev) return fallback('draft-changed')
    const layout = snapshotLayout(snapshot)
    if (!projectDom(root, layout && { ...layout, clipboard: snapshot.draft })) return fallback('draft-changed')
    return status
  }

  return { diffRanges, diffHunks, diffSegments, coalesceRanges, detectSlice, show, clear, check, get status() { return status } }
}

    const inject = ['slots', 'commandUi', 'inputTriggers', 'sessions']
    const API = '/dsh-prompt-refine/api'
    const state = new Map()
    const mountedOverlays = new Map()
    const pendingUnmount = new Map()
    const pendingLaunch = new Map()
    let disposed = false
    const listeners = new Set()
    let generation = 0
    const emit = () => { for (const listener of listeners) listener() }
    const usePanel = (id) => React.useSyncExternalStore(
      (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
      () => state.get(id), () => undefined
    )
    const put = (id, patch) => { state.set(id, { ...state.get(id), ...patch }); emit() }
    const remove = (id) => {
      const panel = state.get(id)
      panel?.confirmation?.resolve(false)
      panel?.abort?.abort()
      panel?.unsubscribe?.()
      panel?.highlights?.clear()
      panel?.refinement?.clear()
      state.delete(id)
      emit()
    }
    // 草稿监听用于及时停止生成；实际写入仍由事务执行版本和内容校验。
    const draftSignature = (snapshot) => JSON.stringify({
      draft: snapshot?.draft, draftRev: snapshot?.draftRev, phase: snapshot?.phase,
      occurrences: snapshot?.occurrences ?? [], attachmentIds: snapshot?.attachmentIds ?? []
    })
    function chipRanges(occurrences) {
      let extra = 0
      return (occurrences ?? []).map((o) => {
        const start = o.offset - extra
        extra += o.length - 1
        return { start, end: start + 1, length: o.length }
      })
    }
    function clipboardAt(d, chips) {
      return d + chips.reduce((n, c) => n + (c.end <= d ? c.length - 1 : 0), 0)
    }
    function capture(input, actions, forceCommand = false) {
      if (!input || !actions || typeof input.draft !== 'string') throw Error('当前会话没有可用的输入框。')
      if (input.phase !== 'plain' && input.phase !== 'claimed') throw Error('输入框正在提交，请稍后重试。')
      const span = actions.captureInsertion()
      if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end)) throw Error('无法读取当前选区。')
      const chips = chipRanges(input.occurrences)
      const selected = span.start < span.end
      if (selected) {
        if (chips.some(c => c.start < span.end && c.end > span.start)) throw Error('选区包含引用，请重新选中纯文本段。')
        const text = input.draft.slice(clipboardAt(span.start, chips), clipboardAt(span.end, chips))
        if (!text.trim()) throw Error('没有可优化的文字。')
        return { original: text, span, mode: 'selection', draft: input.draft, draftRev: input.draftRev }
      }
      if (forceCommand) {
        const match = input.draft.match(/^\s*\/refine\s+([\s\S]+)$/u)
        if (!match || !match[1].trim() || chips.length) throw Error('请在 /refine 后输入正文；若含引用，请先选中纯文本段。')
        const start = input.draft.length - match[1].length
        return { original: match[1], span: { start, end: input.draft.length, draftRev: span.draftRev }, mode: 'selection', draft: input.draft, draftRev: input.draftRev }
      }
      // 命令裁决后才消费 token，因此空草稿和只有 /refine 的草稿需分别判断。
      if (!input.draft.trim()) throw Error('没有可优化的文字。请先输入内容，或选中一段文字。')
      if (/^\s*\/refine\s*$/u.test(input.draft)) throw Error('没有可优化的文字。请在 /refine 后输入要优化的内容，或选中一段文字。')
      if (chips.length || input.phase === 'claimed' || /^\s*\/\S/u.test(input.draft)) throw Error('草稿含引用或命令，请先选中纯文本段。')
      return { original: input.draft, mode: 'whole', draft: input.draft, draftRev: input.draftRev }
    }
    // 事务只拥有被替换范围；写入前校验版本，写入后核对全文和引用。
    // 后续回填和撤销都必须基于上一次已确认的快照。
    function draftTransaction(shell, source) {
      const snapshot = () => shell.state.getSnapshot()
      const record = (s) => ({
        draft: s?.draft, draftRev: s?.draftRev, phase: s?.phase,
        occurrences: JSON.stringify(s?.occurrences ?? []),
        attachmentIds: JSON.stringify(s?.attachmentIds ?? [])
      })
      const matches = (s, saved) => {
        const now = record(s)
        return Object.keys(saved).every(key => now[key] === saved[key])
      }
      let expected = record(snapshot())
      let span = source.span ? { ...source.span } : { start: 0, end: source.draft.length }
      if (expected.draftRev !== source.draftRev || expected.draft !== source.draft || !['plain', 'claimed'].includes(expected.phase)) throw Error('草稿已变化，请重新开始优化。')
      const initialChips = chipRanges(snapshot().occurrences)
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.start > span.end ||
          span.end > source.draft.length - initialChips.reduce((n, c) => n + c.length - 1, 0) ||
          initialChips.some(c => c.start < span.end && c.end > span.start) ||
          source.draft.slice(clipboardAt(span.start, initialChips), clipboardAt(span.end, initialChips)) !== source.original) {
        throw Error('选区已变化，请重新开始优化。')
      }
      let broken = false
      const reason = '草稿已被编辑或提交，已停止写入；没有覆盖你的修改。'
      function write(text) {
        if (broken) throw Error(reason)
        const current = snapshot()
        if (!matches(current, expected) || !['plain', 'claimed'].includes(current?.phase)) { broken = true; throw Error(reason) }
        // 宿主会过滤保留占位符，需在写入前拒绝，避免结果被静默截改。
        if (typeof text !== 'string' || /[\uE100-\uE11D\uFFFC]/u.test(text)) throw Error('结果含不支持的引用占位符。')
        const chips = chipRanges(current.occurrences)
        if (chips.some(c => c.start < span.end && c.end > span.start)) { broken = true; throw Error(reason) }
        const start = clipboardAt(span.start, chips)
        const end = clipboardAt(span.end, chips)
        const nextDraft = current.draft.slice(0, start) + text + current.draft.slice(end)
        const shift = text.length - (end - start)
        const nextChips = (current.occurrences ?? []).map(c => ({ ...c, offset: c.offset >= end ? c.offset + shift : c.offset }))
        const next = { ...expected, draft: nextDraft, draftRev: current.draftRev + Number(nextDraft !== current.draft), occurrences: JSON.stringify(nextChips) }
        let applied
        try { applied = shell.actions.insertText(text, { ...span, draftRev: current.draftRev }) }
        catch (error) { broken = true; throw error }
        if (!applied) { broken = true; throw Error('草稿已变化，已停止写入。') }
        if (!matches(snapshot(), next)) { broken = true; throw Error('回填结果与预期不符，已停止写入；请比较草稿并手动处理。') }
        expected = next
        span = { start: span.start, end: span.start + text.length }
      }
      return { write, undo: () => write(source.original), broken: () => broken, range: () => ({ ...span }) }
    }
    function shellFor(ctx, id) {
      const scope = ctx.sessions.scope(id)
      return scope?.get('conversation')?.input.for(scope)
    }
    function launch(ctx, id, command = false) {
      if (disposed) return
      clearTimeout(pendingLaunch.get(id))
      pendingLaunch.delete(id)
      const shell = shellFor(ctx, id)
      if (!shell) return
      const run = () => {
        pendingLaunch.delete(id)
        if (!disposed) openDraftTransaction(ctx, id, command)
      }
      // 斜杠命令在 Enter 裁决期间触发，等待输入状态稳定后捕获草稿。
      const settle = (tries) => {
        if (disposed) return
        const phase = shell.state.getSnapshot()?.phase
        if ((phase !== 'adjudicating' && phase !== 'submitting') || tries <= 0) return run()
        pendingLaunch.set(id, setTimeout(() => settle(tries - 1), 40))
      }
      settle(50)
    }
    // Composer is authoritative; session synchronizes text, rendering never writes editor content.
    function syncCurrent(id, panel, shell) {
      if (state.get(id)?.tx !== panel?.tx) return shell.state.getSnapshot()
      panel = state.get(id)
      const snapshot = shell.state.getSnapshot()
      if (panel.guard.writing || panel.guard.invalidated) return snapshot
      if (draftSignature(snapshot) === panel.guard.expected) return snapshot
      panel.abort?.abort()
      panel.guard.expected = draftSignature(snapshot)
      if ((panel.source.mode === 'selection') ||
          (panel.source.mode === 'whole' && (snapshot.occurrences ?? []).length)) {
        panel.guard.invalidated = true
        panel.highlights.clear()
        put(id, { busy: false, abort: null, preview: '', token: ++generation, highlightKind: 'none',
          error: '无法可靠追踪当前优化范围，已停止写入；请完成后重新开始。' })
        return snapshot
      }
      if (panel.source.mode === 'whole') panel.refinement.updateCurrent(snapshot.draft)
      put(id, { busy: false, abort: null, preview: '', token: ++generation, resultUnchanged: false,
        error: panel.abort ? '草稿已修改，已停止本次生成；你的修改已保留。' : '' })
      return snapshot
    }
    function currentTransaction(panel, shell) {
      if (panel.source.mode !== 'whole') return panel.tx
      const snapshot = shell.state.getSnapshot()
      return draftTransaction(shell, { original: snapshot.draft, mode: 'whole',
        draft: snapshot.draft, draftRev: snapshot.draftRev })
    }
    function refreshDiff(id, panel) {
      if (state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing || !panel.refinement.hasResult) return
      const shell = shellFor(panel.ctx, id)
      if (!shell) return
      const snapshot = shell.state.getSnapshot()
      const range = panel.source.mode === 'whole' ? { start: 0 } : panel.tx.range()
      try {
        const shown = panel.highlights.show({ root: shell.editor?.getRootElement?.(), snapshot,
          original: panel.refinement.original, result: panel.refinement.current, start: range.start, currentMode: true })
        put(id, { highlightKind: shown.kind, highlightCoverage: shown.coverage ?? 0 })
      } catch {
        try { panel.highlights.clear() } catch {}
        put(id, { highlightKind: 'fallback', highlightCoverage: 0 })
      }
    }
    function openDraftTransaction(ctx, id, command = false) {
      const shell = shellFor(ctx, id)
      if (!shell) return
      try {
        if (state.get(id)?.open) return
        const source = capture(shell.state.getSnapshot(), shell.actions, command)
        const tx = draftTransaction(shell, source)
        const highlights = createHighlightCore({ managed: true })
        const refinement = new RefinementSession()
        refinement.begin(source.original)
        const guard = { expected: draftSignature(shell.state.getSnapshot()),
          writing: false, invalidated: false, composing: false }
        put(id, { open: true, source, refinement, note: '', error: '', busy: false, abort: null,
          token: ++generation, tx, highlights, guard, ctx, highlightKind: 'none' })
        const panel = state.get(id)
        let timer = null
        let root = null
        let observer = null
        const schedule = () => {
          clearTimeout(timer)
          if (guard.composing) return
          timer = setTimeout(() => {
            timer = null
            if (state.get(id)?.tx !== tx) return
            bindRoot()
            syncCurrent(id, state.get(id), shell)
            refreshDiff(id, panel)
          }, 200)
        }
        const onCompositionStart = () => {
          guard.composing = true
          clearTimeout(timer)
          highlights.clear()
          state.get(id)?.abort?.abort()
          put(id, { busy: false, abort: null, preview: '', token: ++generation, highlightKind: 'none' })
        }
        const onCompositionEnd = () => {
          guard.composing = false
          if (state.get(id)?.tx !== tx) return
          syncCurrent(id, state.get(id), shell)
          schedule()
        }
        const bindRoot = () => {
          const next = shell.editor?.getRootElement?.()
          if (root === next) return
          guard.composing = false
          highlights.clear()
          observer?.disconnect()
          root?.removeEventListener?.('compositionstart', onCompositionStart)
          root?.removeEventListener?.('compositionend', onCompositionEnd)
          root = next
          const Observer = root?.ownerDocument?.defaultView?.MutationObserver
          observer = typeof Observer === 'function' ? new Observer(() => {
            if (state.get(id)?.tx !== tx) return
            highlights.clear()
            put(id, { highlightKind: 'none' })
            syncCurrent(id, state.get(id), shell)
            schedule()
          }) : null
          observer?.observe(root, { subtree: true, childList: true, characterData: true })
          root?.addEventListener?.('compositionstart', onCompositionStart)
          root?.addEventListener?.('compositionend', onCompositionEnd)
          return true
        }
        bindRoot()
        const unsubscribeRefinement = refinement.subscribe(() => {
          put(id, { refinementSnapshot: refinement.getSnapshot() })
          schedule()
        })
        const unsubscribeRoot = shell.editor?.registerRootListener?.(() => {
          if (state.get(id)?.tx === tx && bindRoot()) {
            put(id, { highlightKind: 'none' })
            schedule()
          }
        })
        const session = ctx.sessions.binding?.(id)?.session
        const pendingSubmissions = () => session?.getSnapshot?.()?.pendingSubmissions ?? []
        const existingSubmissions = new Set(pendingSubmissions().map(item => item.requestId))
        const closeForSubmission = () => {
          if (state.get(id)?.tx !== tx) return false
          // 普通发送保持 plain，通过 Session 新增提交标识判断；命令进入 submitting。
          // 只比较提交标识，不读取或发送提交正文。
          if (!pendingSubmissions().some(item => item.requestId && !existingSubmissions.has(item.requestId))) return false
          remove(id)
          return true
        }
        const unsubscribeInput = shell.state.subscribe?.(() => {
          if (state.get(id)?.tx !== tx) return
          const snapshot = shell.state.getSnapshot()
          // 提交检查先于失效检查，确保手动编辑后的面板也能在发送时关闭。
          if (snapshot?.phase === 'submitting') { remove(id); return }
          if (closeForSubmission()) return
          if (guard.writing || guard.invalidated) return
          if (bindRoot()) schedule()
          if (draftSignature(snapshot) !== guard.expected) {
            highlights.clear()
            put(id, { highlightKind: 'none' })
            syncCurrent(id, state.get(id), shell)
            schedule()
          }
        })
        const unsubscribeSession = session?.subscribe?.(closeForSubmission)
        panel.unsubscribe = () => {
          unsubscribeInput?.(); unsubscribeSession?.(); unsubscribeRefinement(); unsubscribeRoot?.()
          clearTimeout(timer)
          observer?.disconnect()
          root?.removeEventListener?.('compositionstart', onCompositionStart)
          root?.removeEventListener?.('compositionend', onCompositionEnd)
        }
        void generate(id, panel)
      } catch (error) {
        shell.notify('error', error.message)
      }
    }
    function confirmOverwrite(id, panel, message, resolve) {
      if (state.get(id)?.tx !== panel.tx || state.get(id)?.confirmation) { resolve(false); return }
      put(id, { confirmation: { message, resolve } })
    }
    function answerConfirmation(id, panel, accepted) {
      const live = state.get(id)
      if (live?.tx !== panel.tx || !live.confirmation) return
      const confirmation = live.confirmation
      put(id, { confirmation: null })
      confirmation.resolve(accepted)
    }
    async function generate(id, panel) {
      if (state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing) return
      const shell = shellFor(panel.ctx, id)
      if (!shell) return
      panel = state.get(id)
      syncCurrent(id, panel, shell)
      panel = state.get(id)
      if (!panel || panel.guard.invalidated) return
      const requestSignature = draftSignature(shell.state.getSnapshot())
      if (panel.refinement.dirty && !await new Promise(resolve => confirmOverwrite(id, panel,
        '当前内容已经修改，重新生成会覆盖你的修改。是否继续？', resolve))) return
      // A confirmation is not permission to overwrite a later revision.
      if (state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing ||
        draftSignature(shell.state.getSnapshot()) !== requestSignature) return
      panel.abort?.abort()
      const writeTx = currentTransaction(panel, shell)
      const controller = new AbortController()
      const token = ++generation
      const requestNote = panel.note
      // 增量仅作预览；失败或停止不写草稿，重新生成期间保留上次成功结果。
      put(id, { preview: '', error: '', busy: true, abort: controller, token, resultUnchanged: false })
      try {
        const response = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, text: panel.refinement.original, note: requestNote }), signal: controller.signal })
        if (!response.ok) {
          let message = `请求失败 (${response.status})`
          try { message = (await response.json()).error ?? message } catch {}
          throw Error(message)
        }
        if (!response.body) throw Error('服务器未返回流。')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let preview = ''
        let finalText = null
        function consume(message) {
          const line = message.split('\n').find(s => s.startsWith('data: '))
          const type = message.split('\n').find(s => s.startsWith('event: '))?.slice(7)
          if (controller.signal.aborted || state.get(id)?.token !== token) return
          if (finalText !== null && message.trim()) throw Error('模型完成后仍返回数据，未回填草稿。')
          if (!line || !type) return
          const data = JSON.parse(line.slice(6))
          if (type === 'delta') {
            if (typeof data.text !== 'string') throw Error('模型返回了无效的结果。')
            preview += data.text
            put(id, { preview })
          }
          if (type === 'done') {
            if (typeof data.text !== 'string' || !data.text || /[\uE100-\uE11D\uFFFC]/u.test(data.text)) throw Error('模型返回了无效的结果。')
            finalText = data.text
          }
          if (type === 'failure') throw Error(data.error)
        }
        while (true) {
          const { done, value } = await reader.read()
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
          let index
          while ((index = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 2) }
          if (done) break
        }
        if (!controller.signal.aborted && state.get(id)?.token === token && !panel.guard.composing) {
          if (buffer.trim()) throw Error('模型返回了不完整的数据，未回填草稿。')
          if (finalText === null) throw Error('模型未完成响应，请重试。')
          // Commit only a normally completed response against the request's unchanged draft.
          if (draftSignature(shell.state.getSnapshot()) !== requestSignature) throw Error('草稿已变化，已停止写入；没有覆盖你的修改。')
          panel.guard.writing = true
          try { writeTx.write(finalText) }
          finally { panel.guard.writing = false }
          if (state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing ||
            state.get(id)?.token !== token) return
          const snapshot = shell.state.getSnapshot()
          panel.guard.expected = draftSignature(snapshot)
          const unchanged = panel.refinement.hasResult && finalText === panel.refinement.optimized
          panel.refinement.applyGeneration(finalText)
          refreshDiff(id, panel)
          put(id, { preview: '', resultUnchanged: unchanged })
        }
      } catch (error) {
        if (state.get(id)?.token === token && !controller.signal.aborted) put(id, { error: error.message })
        controller.abort()
      } finally {
        if (state.get(id)?.token === token) put(id, { busy: false, abort: null, preview: '' })
      }
    }
    // 按钮背景和选中态由样式表控制，避免行内背景压过悬停规则。
    const base = { font: 'inherit', fontSize: 14, lineHeight: '20px', padding: '4px 8px', borderRadius: 6,
      cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid transparent',
      color: 'var(--dsw-alias-label-secondary, #6E7681)' }
    // 完成按钮使用固定蓝底白字，避免宿主主题变量导致文字与背景对比不足。
    const btn = { ...base, fontWeight: 500 }
    const primary = { ...base, color: '#fff' }
    const triggerCss = '.dsh-prompt-refine-trigger { background: transparent !important; }' +
      '.dsh-prompt-refine-trigger:hover { background: var(--dsw-alias-fill-secondary, #F0F1F3) !important; color: var(--dsw-alias-label-primary, #E7E9EE); }' +
      '.dsh-prompt-refine-trigger[data-active="true"] { background: var(--dsw-alias-bg-module-platform, #ffffff1a) !important; }' +
      '.dsh-prompt-refine-trigger:disabled:hover { background: transparent !important; color: var(--dsw-alias-label-secondary, #6E7681); }' +
      '.dsh-prompt-refine-primary { background: #3157D5 !important; color: #fff !important; -webkit-text-fill-color: #fff !important; }' +
      '.dsh-prompt-refine-primary:hover { background: #2544AE !important; color: #fff !important; }' +
      '.dsh-prompt-refine-primary:active { background: #203B97 !important; color: #fff !important; }'
    const stripStyle = { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1, boxSizing: 'border-box',
      padding: '6px 10px', maxHeight: 'min(60vh, 340px)', overflowY: 'auto',
      borderTopLeftRadius: 'var(--dsh-prompt-refine-top-left-radius, 0px)',
      borderTopRightRadius: 'var(--dsh-prompt-refine-top-right-radius, 0px)',
      borderBottom: '1px solid var(--dsw-alias-border-l2, #ffffff1a)',
      background: 'var(--dsw-specific-input-major, #24282F)',
      color: 'var(--dsw-alias-label-primary, #E7E9EE)' }
    const rowStyle = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }
    // 状态徽标使用成对的文字和背景颜色，保证两种主题下可读。
    const statusStyle = { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto',
      minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 500 }
    const statusBadgeStyle = { display: 'inline-block', padding: '4px 8px', borderRadius: 6,
      fontSize: 14, fontWeight: 600, flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }
    const statusColors = {
      success: { background: '#E7F4EC', color: '#167044' },
      busy: { background: '#EDF1FF', color: '#3157D5' },
      neutral: { background: '#F0F1F4', color: '#353944' },
      stopped: { background: '#FFF3DC', color: '#895B0E' }
    }
    const groupStyle = { display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }
    const dividerStyle = { width: 1, height: 16, background: 'var(--dsw-alias-border-l2, #ffffff1f)', flex: '0 0 auto' }
    const fieldStyle = { width: '100%', marginTop: 6, boxSizing: 'border-box', font: 'inherit', fontSize: 14,
      fontWeight: 500, padding: '6px 8px', borderRadius: 6, border: '1px solid #C9CED6',
      background: '#F1F2F4', color: '#1E2430' }
    const fieldCss = '.dsh-prompt-refine-field::placeholder { color: #6B7280; opacity: 1; }'
    const errorStyle = { font: 'inherit', fontSize: 13, fontWeight: 500, lineHeight: '20px',
      color: '#ff9b9b', marginTop: 6, overflowWrap: 'anywhere' }
    const hintStyle = { display: 'block', marginTop: 4, fontSize: 11, opacity: 0.55 }
    function Button(props) {
      const panel = usePanel(props.sessionId)
      const selected = !!panel?.open
      return React.createElement('button', { type: 'button', className: 'dsh-prompt-refine-trigger', style: btn, disabled: selected, onClick: () => launch(props.refineContext, props.sessionId) }, '优化提示词')
    }
    // 浮层锚点不占高度，仅在所属输入卡片内预留空间，避免遮挡正文。
    const reserveCss = '[data-composer-card][data-dsh-prompt-refine-reserve] { padding-top: calc(var(--dsh-prompt-refine-base-padding, 8px) + var(--dsh-prompt-refine-panel-height, 0px)); }'
    function Overlay(props) {
      const id = props.sessionId
      const panel = usePanel(id)
      const wrapper = React.useRef(null)
      React.useLayoutEffect(() => {
        if (!panel?.open) return
        const element = wrapper.current
        const card = element?.closest('[data-composer-card]')
        if (!card) return
        const originalAttribute = card.getAttribute('data-dsh-prompt-refine-reserve')
        const originalBase = [card.style.getPropertyValue('--dsh-prompt-refine-base-padding'), card.style.getPropertyPriority('--dsh-prompt-refine-base-padding')]
        const originalHeight = [card.style.getPropertyValue('--dsh-prompt-refine-panel-height'), card.style.getPropertyPriority('--dsh-prompt-refine-panel-height')]
        const view = element.ownerDocument?.defaultView
        const basePadding = view?.getComputedStyle?.(card)?.paddingTop || '8px'
        card.style.setProperty('--dsh-prompt-refine-base-padding', basePadding)
        card.setAttribute('data-dsh-prompt-refine-reserve', '')
        let live = true
        const measure = () => {
          if (!live) return
          // 浮层与卡片不是同一节点，需分别读取并复制两个顶部圆角。
          const cardStyle = view?.getComputedStyle?.(card)
          element.style.setProperty('--dsh-prompt-refine-top-left-radius', cardStyle?.borderTopLeftRadius || '0px')
          element.style.setProperty('--dsh-prompt-refine-top-right-radius', cardStyle?.borderTopRightRadius || '0px')
          card.style.setProperty('--dsh-prompt-refine-panel-height', `${Math.ceil(element.getBoundingClientRect().height) + 8}px`)
        }
        measure()
        const Observer = view?.ResizeObserver ?? (typeof ResizeObserver === 'function' ? ResizeObserver : null)
        const observer = Observer ? new Observer(measure) : null
        observer?.observe(element)
        if (!observer) view?.addEventListener?.('resize', measure)
        return () => {
          live = false
          observer?.disconnect()
          if (!observer) view?.removeEventListener?.('resize', measure)
          if (originalAttribute === null) card.removeAttribute('data-dsh-prompt-refine-reserve')
          else card.setAttribute('data-dsh-prompt-refine-reserve', originalAttribute)
          for (const [name, [value, priority]] of [
            ['--dsh-prompt-refine-base-padding', originalBase],
            ['--dsh-prompt-refine-panel-height', originalHeight]
          ]) {
            if (value) card.style.setProperty(name, value, priority)
            else card.style.removeProperty(name)
          }
        }
      }, [id, !!panel?.open])
      React.useLayoutEffect(() => {
        const pending = pendingUnmount.get(id)
        if (pending !== undefined) { clearTimeout(pending); pendingUnmount.delete(id) }
        mountedOverlays.set(id, (mountedOverlays.get(id) ?? 0) + 1)
        return () => {
          const remaining = (mountedOverlays.get(id) ?? 1) - 1
          if (remaining > 0) { mountedOverlays.set(id, remaining); return }
          mountedOverlays.delete(id)
          // 延迟一轮清理，允许 React 严格模式或输入框切换时的立即重挂载取消清理。
          // 真正卸载后释放当前会话的请求、高亮和订阅。
          if (pendingUnmount.has(id)) return
          pendingUnmount.set(id, setTimeout(() => { pendingUnmount.delete(id); remove(id) }, 0))
        }
      }, [id])
      if (!panel?.open) return null
      const h = React.createElement
      const stop = () => {
        const live = state.get(id)
        if (live?.tx !== panel.tx) return
        live.abort?.abort()
        put(id, { busy: false, abort: null, token: ++generation })
      }
      const finish = () => { if (state.get(id)?.tx !== panel.tx) return; stop(); remove(id) }
      const undo = () => {
        if (state.get(id)?.tx !== panel.tx) return
        const shell = shellFor(panel.ctx, id)
        if (!shell) return
        syncCurrent(id, state.get(id), shell)
        if (panel.guard.invalidated || panel.guard.composing) return
        const expected = draftSignature(shell.state.getSnapshot())
        const restore = accepted => {
          if (!accepted || state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing ||
            draftSignature(shell.state.getSnapshot()) !== expected) return
          stop()
          try {
            const tx = currentTransaction(panel, shell)
            panel.guard.writing = true
            tx.write(panel.refinement.original)
            remove(id)
          } catch (error) {
            if (state.get(id)?.tx === panel.tx) put(id, { error: error.message + ' 可展开原文查看。' })
          }
          finally { panel.guard.writing = false }
        }
        if (panel.refinement.dirty) confirmOverwrite(id, panel,
          '当前内容已经修改，撤销会覆盖你的修改。是否继续？', restore)
        else restore(true)
      }
      const button = (text, onClick, disabled = false, style = btn, dataActive) =>
        h('button', { type: 'button', className: 'dsh-prompt-refine-trigger', 'data-active': dataActive ? 'true' : undefined, style, disabled, onClick }, text)
      const toggle = (text, key) => button(text, () => {
        const live = state.get(id)
        if (live?.tx === panel.tx) put(id, { [key]: !live[key] })
      }, false, btn, !!panel[key])
      const statusText = panel.busy ? '正在优化草稿…'
        : panel.guard?.invalidated ? '优化范围已变化，已停止写入'
          : panel.refinement.dirty ? '正在编辑 · 差异实时更新'
          : panel.refinement.hasResult
            ? (panel.resultUnchanged ? '已重新生成 · 结果与上次相同'
              : panel.highlightKind === 'highlighted'
              ? (panel.highlightCoverage >= 0.6 ? '已优化 · 改动较大' : '已优化 · 改动已标出')
              : '已优化')
            : '优化草稿'
      const [statusLabel] = statusText.split(' · ')
      const statusTone = panel.busy ? 'busy' : panel.guard?.invalidated ? 'stopped'
        : panel.refinement.hasResult && !panel.resultUnchanged ? 'success' : 'neutral'
      return h('section', { ref: wrapper, 'aria-label': '提示词优化操作条', style: stripStyle },
        h('style', null, `${reserveCss} ${fieldCss}`),
        h('div', { style: rowStyle },
          h('span', { style: statusStyle, title: statusText, role: 'status', 'aria-live': 'polite', 'aria-label': statusText },
            h('span', { className: 'dsh-prompt-refine-status-badge', style: { ...statusBadgeStyle, ...statusColors[statusTone] } }, statusLabel)),
          h('div', { style: groupStyle },
            toggle('原文', 'showOriginal'),
            toggle('补充要求', 'showNote'),
            h('span', { style: dividerStyle }),
            panel.busy ? button('停止生成', stop) : button('重新生成', () => generate(id, panel), !!panel.guard?.invalidated || panel.guard.composing),
            button('撤销优化', undo, !!panel.guard?.invalidated || panel.guard.composing || !panel.refinement.hasResult),
            h('button', { type: 'button', className: 'dsh-prompt-refine-primary', style: primary, onClick: finish }, '完成'))),
        panel.showOriginal && h('textarea', { className: 'dsh-prompt-refine-field', 'aria-label': '优化前原文', readOnly: true, value: panel.refinement.original, style: { ...fieldStyle, minHeight: 56, maxHeight: 140, resize: 'vertical' } }),
        panel.showNote && h('input', { className: 'dsh-prompt-refine-field', 'aria-label': '本次补充要求', placeholder: '补充要求（重新生成时生效）', value: panel.note, maxLength: 2000, onChange: e => { if (state.get(id)?.tx === panel.tx) put(id, { note: e.target.value }) }, style: fieldStyle }),
        panel.confirmation && h('div', { role: 'alert', style: rowStyle },
          h('span', { style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' } }, panel.confirmation.message),
          h('div', { style: { ...groupStyle, marginLeft: 'auto' } },
            button('确认覆盖', () => answerConfirmation(id, panel, true)),
            button('取消', () => answerConfirmation(id, panel, false)))),
        panel.error && h('div', { role: 'alert', className: 'dsh-prompt-refine-error', style: errorStyle }, panel.error),
        !panel.refinement.hasResult && !panel.busy && h('small', { style: hintStyle }, '生成完成后才写入输入框，不会自动发送。'))
    }
    function apply(ctx) {
      disposed = false
      ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-prompt-refine-overlay', order: 100, inject: (sessionId) => ({ sessionId }) }, Overlay))
      ctx.effect(() => () => {
        disposed = true
        for (const timer of pendingLaunch.values()) clearTimeout(timer)
        pendingLaunch.clear()
        for (const timer of pendingUnmount.values()) clearTimeout(timer)
        pendingUnmount.clear()
        mountedOverlays.clear()
        for (const id of [...state.keys()]) remove(id)
      }, 'prompt-refine: cleanup')
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-prompt-refine-button', order: 35, inject: (sessionId) => ({ sessionId, refineContext: ctx }) }, Button))
      // 触发按钮在面板关闭时仍可见，样式生命周期绑定插件而非单次浮层。
      ctx.effect(() => {
        const style = globalThis.document?.createElement?.('style')
        if (!style) return
        style.textContent = triggerCss
        globalThis.document.head.appendChild(style)
        return () => style.remove()
      }, 'prompt-refine: trigger hover style')
      ctx.effect(() => ctx.commandUi.register({ name: 'refine', label: () => '优化提示词', available: () => true, ui: { kind: 'action', run: (session) => launch(ctx, session.sessionId) } }), 'prompt-refine: command menu')
      ctx.effect(() => ctx.inputTriggers.registerSource({ trigger: '/', name: 'prompt-refine-enter', candidates: async () => [], onPick: () => undefined,
        matchEnter: (session, line) => {
          // 只有 /refine 时交由宿主菜单处理；携带正文时直接优化正文。
          if (!/^\/refine\s+[\s\S]+$/u.test(line)) return
          launch(ctx, session.sessionId, true)
          return 'handled'
        }
      }), 'prompt-refine: typed command')
    }
    exports.apply = apply
    exports.createHighlightCore = createHighlightCore
    exports.inject = inject
    exports.draftTransaction = draftTransaction
    exports.capture = capture
    exports.chipRanges = chipRanges
    exports.clipboardAt = clipboardAt
    exports.triggerCss = triggerCss
    return exports
  }
})

})()
