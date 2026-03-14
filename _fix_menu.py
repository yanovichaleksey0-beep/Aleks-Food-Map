import sys

path = "/Users/yanovich/aleks-food-map/src/App.jsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Find the Copy link text with smart quotes
copy_link_idx = content.find("\u201cCopy link\u201d")
if copy_link_idx == -1:
    print("Could not find Copy link text")
    sys.exit(1)

old = '                    </p>\n                  </div>\n                ) : null}\n\n                {menuTab === "featured"'

match_idx = content.find(old, copy_link_idx)
if match_idx == -1:
    print("Could not find old pattern after Copy link")
    sys.exit(1)

new_text = '                    </p>\n\n                    <div className="mt-4 grid grid-cols-2 gap-2">\n                      <button\n                        type="button"\n                        onClick={exportPlaces}\n                        className="min-h-[44px] rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900"\n                      >\n                        Export JSON\n                      </button>\n                      <button\n                        type="button"\n                        onClick={clearLocalEdits}\n                        className="min-h-[44px] rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900"\n                      >\n                        Reset edits\n                      </button>\n                    </div>\n                    <p className="text-[11px] text-neutral-500">\n                      Quick-edits save in this browser. Export JSON to make them permanent in your repo.\n                    </p>\n                  </div>\n                ) : null}\n\n                {menuTab === "featured"'

content = content[:match_idx] + new_text + content[match_idx + len(old):]

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Done")
