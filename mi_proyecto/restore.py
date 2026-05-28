import sys
import re

log_path = r"C:\Users\Administrator\.gemini\antigravity\brain\96a6bf9e-18aa-4b69-aa1a-78ea26f9a4da\.system_generated\logs\overview.txt"

with open(log_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

output = []
recording = False

for line in lines:
    if "File Path: `file:///c:/Users/Administrator/Downloads/pagina%20actigravity/earthquake-3d.js`" in line:
        recording = True
        output = [] # Reset, in case we find it multiple times, we want the first full one... actually we want the one with 800 lines.
        continue
    
    if recording:
        # Match lines like "1: // =============================..."
        match = re.match(r'^(\d+):\s(.*)', line)
        if match:
            line_num = int(match.group(1))
            line_content = match.group(2)
            if line_num == len(output) + 1:
                output.append(line_content)
        elif "The above content does NOT show the entire file contents" in line:
            recording = False
            break

# The output has 800 lines. We need to add the last 5 closing lines.
if len(output) == 800:
    output.append("        updateEquations();")
    output.append("    };")
    output.append("})();")

with open(r"c:\Users\Administrator\Downloads\pagina actigravity\earthquake-3d.js", "w", encoding="utf-8") as f:
    f.write("\n".join(output))

print(f"Restored {len(output)} lines to earthquake-3d.js")
