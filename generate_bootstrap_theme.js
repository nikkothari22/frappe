const fs = require("fs");
const path = require("path");
const { sass, sass_options } = require("./esbuild/sass_compiler");

const output_path = process.argv[2];
const scss_content = process.argv[3].replace(/\\n/g, "\n");

const css_import = /@import\s*(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/g;

// where sass found the import, e.g. "frappe/public/css/..." under apps/frappe
function resolve_import(url) {
	for (const base of sass_options.loadPaths) {
		const file = path.resolve(base, url);
		if (file.startsWith(base + path.sep) && fs.existsSync(file)) return file;
	}
}

// Sass leaves an @import of a .css file (Espresso's tokens and components, the Inter font)
// as a plain CSS import. The desk build's esbuild inlines those; a theme is served from
// /files, where the browser can't resolve them. So inline the ones that live in an app,
// and keep remote ones (web fonts) ahead of everything, where CSS requires @import to be.
function inline_css_imports(css, seen = new Set()) {
	const remote = [];
	const body = css.replace(css_import, (statement, url) => {
		if (/^([a-z]+:)?\/\//i.test(url)) {
			remote.push(statement);
			return "";
		}
		const file = resolve_import(url);
		if (!file) return statement;
		if (seen.has(file)) return "";
		seen.add(file);
		const inlined = inline_css_imports(fs.readFileSync(file, "utf8"), seen);
		remote.push(...inlined.remote);
		return inlined.body;
	});
	return { remote, body };
}

// The caller (website_theme.py) treats anything on stderr as a compile
// failure, so errors go to console.error and success prints only the path.
sass.compileStringAsync(scss_content, {
	style: "compressed",
	...sass_options,
	sourceMap: false,
})
	.then((result) => {
		// compressed output marks non-ASCII content with a BOM, which has to stay first
		const bom = result.css.startsWith("﻿") ? "﻿" : "";
		const { remote, body } = inline_css_imports(result.css.slice(bom.length));
		return fs.promises.writeFile(output_path, bom + remote.join("") + body);
	})
	.then(() => console.log(output_path))
	.catch((err) => {
		console.error(err.message || err);
		process.exitCode = 1;
	});
