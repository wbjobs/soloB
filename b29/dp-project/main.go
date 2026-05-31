package main

import (
	"fmt"
	"os"

	"dp/internal/commands"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "filter":
		if err := commands.Filter(args); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	case "map":
		if err := commands.Map(args); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	case "tee":
		if err := commands.Tee(args); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", cmd)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("dp - Data Processor")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  dp <command> [arguments]")
	fmt.Println()
	fmt.Println("Commands:")
	fmt.Println("  filter <expression>  Filter JSON Lines using JMESPath expression")
	fmt.Println("  map <expression>     Transform JSON Lines using JMESPath expression")
	fmt.Println("  tee <file>           Copy input to file while passing through to stdout")
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  cat data.jsonl | dp filter \"age > 30\" | dp map \"name\"")
	fmt.Println("  cat data.jsonl | dp tee intermediate.jsonl | dp map \"name\"")
}
