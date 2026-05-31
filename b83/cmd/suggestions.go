package cmd

import (
	"context"
	"strings"
	"unicode"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type CommandSuggestion struct {
	Command     string   `json:"command"`
	Score       int      `json:"score"`
	Type        string   `json:"type"`
	Args        []string `json:"args,omitempty"`
	Description string   `json:"description,omitempty"`
}

type CommandTree struct {
	Command    string
	Count      int
	SubCommands map[string]*CommandTree
}

var builtInCommands = map[string][]string{
	"ls": {"-la", "-lh", "-a", "-l", "-R", "-t"},
	"cd": {"..", "-", "~", "/"},
	"git": {"status", "add", "commit", "push", "pull", "checkout", "branch", "log", "diff"},
	"docker": {"ps", "run", "build", "images", "exec", "logs", "compose"},
	"npm": {"install", "run", "build", "test", "publish", "init"},
	"kubectl": {"get", "apply", "delete", "describe", "logs", "exec"},
	"grep": {"-r", "-i", "-v", "-n"},
	"find": {"-name", "-type", "-mtime"},
	"cat": {"-n", "-b"},
	"tail": {"-f", "-n", "-F"},
	"head": {"-n"},
	"ssh": {"-p", "-i"},
	"scp": {"-r", "-P"},
	"curl": {"-X", "-H", "-d", "-o", "-I"},
	"wget": {"-c", "-O", "-P"},
	"tar": {"-xzf", "-czf", "-tvf", "-xjf"},
	"chmod": {"+x", "755", "644", "-R"},
	"chown": {"-R"},
	"ps": {"aux", "ef"},
	"top": {"-u", "-p"},
	"df": {"-h", "-i"},
	"du": {"-sh", "-h", "-a"},
	"mkdir": {"-p"},
	"rm": {"-rf", "-r", "-f"},
	"cp": {"-r", "-R", "-a"},
	"mv": {"-n", "-f", "-i"},
	"echo": {"-n", "-e"},
	"sed": {"-i", "-e", "-n"},
	"awk": {"-F", "-v"},
	"jq": {"'.'", "'.[]", "'.key'"},
	"python": {"-m", "--version", "-c"},
	"node": {"--version", "-e", "-r"},
	"go": {"run", "build", "test", "mod", "get", "install", "fmt", "vet"},
	"rustc": {"--version", "-o", "-O"},
	"cargo": {"build", "run", "test", "new", "add"},
}

func ParseCommand(line string) []string {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil
	}

	var parts []string
	var current strings.Builder
	inQuote := false
	var quoteChar rune

	for _, r := range line {
		if !inQuote && (r == '\'' || r == '"') {
			inQuote = true
			quoteChar = r
			current.WriteRune(r)
		} else if inQuote && r == quoteChar {
			inQuote = false
			current.WriteRune(r)
		} else if !inQuote && unicode.IsSpace(r) {
			if current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			}
		} else {
			current.WriteRune(r)
		}
	}

	if current.Len() > 0 {
		parts = append(parts, current.String())
	}

	return parts
}

func GetUserCommandHistory(ctx context.Context, db *mongo.Database, userID string, tenantID string) ([]CommandSuggestion, error) {
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{
			"user_id": userID,
			"tenant_id": tenantID,
			"command": bson.M{"$exists": true, "$ne": ""},
		}}},
		{{Key: "$group", Value: bson.M{
			"_id":   "$command",
			"count": bson.M{"$sum": 1},
		}}},
		{{Key: "$sort", Value: bson.M{"count": -1}}},
		{{Key: "$limit", Value: 100}},
	}

	cursor, err := db.Collection("command_records").Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var results []struct {
		Command string `bson:"_id"`
		Count   int    `bson:"count"`
	}
	if err := cursor.All(ctx, &results); err != nil {
		return nil, err
	}

	suggestions := make([]CommandSuggestion, 0, len(results))
	for _, r := range results {
		suggestions = append(suggestions, CommandSuggestion{
			Command: r.Command,
			Score:   r.Count,
			Type:    "history",
		})
	}

	return suggestions, nil
}

func GetSuggestions(ctx context.Context, db *mongo.Database, userID string, tenantID string, input string, cursorPos int) []CommandSuggestion {
	input = input[:cursorPos]
	parts := ParseCommand(input)
	
	var suggestions []CommandSuggestion

	if len(parts) == 0 || (len(parts) == 1 && !strings.HasSuffix(input, " ")) {
		prefix := ""
		if len(parts) > 0 {
			prefix = parts[0]
		}
		
		historySugs, _ := GetUserCommandHistory(ctx, db, userID, tenantID)
		for _, sug := range historySugs {
			if prefix == "" || strings.HasPrefix(strings.ToLower(sug.Command), strings.ToLower(prefix)) {
				suggestions = append(suggestions, sug)
			}
		}

		for cmd := range builtInCommands {
			if prefix == "" || strings.HasPrefix(cmd, strings.ToLower(prefix)) {
				suggestions = append(suggestions, CommandSuggestion{
					Command: cmd,
					Score:   50,
					Type:    "builtin",
				})
			}
		}
	} else if len(parts) >= 1 {
		baseCmd := strings.ToLower(parts[0])
		if args, ok := builtInCommands[baseCmd]; ok {
			var currentArg string
			if len(parts) > 1 && !strings.HasSuffix(input, " ") {
				currentArg = strings.ToLower(parts[len(parts)-1])
			}

			for _, arg := range args {
				if currentArg == "" || strings.HasPrefix(arg, currentArg) {
					fullCmd := strings.Join(parts[:len(parts)-1], " ") + " " + arg
					if currentArg == "" {
						fullCmd = input + arg
					}
					suggestions = append(suggestions, CommandSuggestion{
						Command: fullCmd,
						Score:   80,
						Type:    "argument",
						Args:    []string{arg},
					})
				}
			}
		}

		historySugs, _ := GetUserCommandHistory(ctx, db, userID, tenantID)
		for _, sug := range historySugs {
			if strings.HasPrefix(strings.ToLower(sug.Command), strings.ToLower(input)) {
				suggestions = append(suggestions, sug)
			}
		}
	}

	seen := make(map[string]bool)
	uniqueSuggestions := make([]CommandSuggestion, 0, len(suggestions))
	for _, sug := range suggestions {
		if !seen[sug.Command] {
			seen[sug.Command] = true
			uniqueSuggestions = append(uniqueSuggestions, sug)
		}
	}

	for i := range uniqueSuggestions {
		if uniqueSuggestions[i].Type == "history" {
			uniqueSuggestions[i].Score += 100
		}
	}

	if len(uniqueSuggestions) > 10 {
		uniqueSuggestions = uniqueSuggestions[:10]
	}

	return uniqueSuggestions
}

func BuildCommandTree(ctx context.Context, db *mongo.Database, userID string, tenantID string) *CommandTree {
	root := &CommandTree{SubCommands: make(map[string]*CommandTree)}

	historySugs, _ := GetUserCommandHistory(ctx, db, userID, tenantID)
	for _, sug := range historySugs {
		parts := ParseCommand(sug.Command)
		if len(parts) == 0 {
			continue
		}

		current := root
		for i, part := range parts {
			if _, exists := current.SubCommands[part]; !exists {
				current.SubCommands[part] = &CommandTree{
					Command:     part,
					SubCommands: make(map[string]*CommandTree),
				}
			}
			current = current.SubCommands[part]
			if i == len(parts)-1 {
				current.Count += sug.Score
			}
		}
	}

	return root
}

func GetTopCommands(ctx context.Context, db *mongo.Database, userID string, tenantID string, limit int64) ([]CommandSuggestion, error) {
	opts := options.Find().SetSort(bson.D{{Key: "timestamp", Value: -1}}).SetLimit(limit)
	cursor, err := db.Collection("command_records").Find(ctx, bson.M{
		"user_id": userID,
		"tenant_id": tenantID,
	}, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var records []struct {
		Command string `bson:"command"`
	}
	if err := cursor.All(ctx, &records); err != nil {
		return nil, err
	}

	counts := make(map[string]int)
	for _, r := range records {
		counts[r.Command]++
	}

	suggestions := make([]CommandSuggestion, 0, len(counts))
	for cmd, count := range counts {
		suggestions = append(suggestions, CommandSuggestion{
			Command: cmd,
			Score:   count,
			Type:    "recent",
		})
	}

	return suggestions, nil
}
