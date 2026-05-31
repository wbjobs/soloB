import click
from datetime import datetime
from pathlib import Path

from .git_utils import GitAnalyzer
from .report import generate_text_report


@click.group()
@click.version_option()
def cli():
    """Git Insight - Analyze your Git repository history"""
    pass


@cli.command()
@click.option(
    '--since',
    default='1 month ago',
    help='Time range to analyze (e.g., "1 year ago", "6 months ago", "2024-01-01")',
)
@click.option(
    '--top',
    default=10,
    type=int,
    help='Number of top contributors to show (default: 10)',
)
@click.option(
    '--repo',
    default='.',
    help='Path to the Git repository (default: current directory)',
)
@click.option(
    '--output',
    '-o',
    default=None,
    type=click.Path(),
    help='Output file path (default: print to stdout)',
)
@click.option(
    '--include-merges',
    is_flag=True,
    default=False,
    help='Include merge commits in statistics (default: exclude merges)',
)
@click.option(
    '--file-pattern',
    default=None,
    help='Filter commits by file pattern (regex). Only analyze commits that modify files matching this pattern.',
)
def analyze(since, top, repo, output, include_merges, file_pattern):
    """Analyze Git repository history and generate a report"""
    try:
        repo_path = Path(repo).resolve()
        analyzer = GitAnalyzer(str(repo_path))
        
        click.echo(f"Analyzing repository: {repo_path}")
        click.echo(f"Time range: Since {since}")
        if include_merges:
            click.echo("Including merge commits in statistics")
        if file_pattern:
            click.echo(f"File pattern filter: {file_pattern}")
        click.echo(f"Fetching commits...\n")
        
        report_data = analyzer.generate_report(
            since=since,
            top_n=top,
            include_merges=include_merges,
            file_pattern=file_pattern
        )
        report_data['repo_path'] = str(repo_path)
        report_data['generated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        report = generate_text_report(report_data)
        
        if output:
            output_path = Path(output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(report)
            click.echo(f"Report saved to: {output_path}")
        else:
            click.echo(report)
            
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)
        return 1
    except Exception as e:
        click.echo(f"Unexpected error: {e}", err=True)
        return 1


@cli.command()
@click.option(
    '--repo',
    default='.',
    help='Path to the Git repository (default: current directory)',
)
def info(repo):
    """Show basic repository information"""
    try:
        repo_path = Path(repo).resolve()
        analyzer = GitAnalyzer(str(repo_path))
        
        click.echo(f"Repository: {repo_path}")
        click.echo(f"Remote URL: {analyzer.repo.remotes[0].url if analyzer.repo.remotes else 'N/A'}")
        
        try:
            head_commit = analyzer.repo.head.commit
            click.echo(f"Current branch: {analyzer.repo.active_branch.name}")
            click.echo(f"Head commit: {head_commit.hexsha[:8]}")
            click.echo(f"Head author: {head_commit.author.name} <{head_commit.author.email}>")
            click.echo(f"Head date: {datetime.fromtimestamp(head_commit.committed_date)}")
        except Exception:
            click.echo("Note: Repository has no commits yet.")
            
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)
        return 1


if __name__ == '__main__':
    cli()
