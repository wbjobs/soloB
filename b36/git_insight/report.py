WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def format_contributors(contributors):
    lines = [
        '\n' + '=' * 60,
        'Top Contributors',
        '=' * 60,
        f"{'Rank':<6} {'Contributor':<45} {'Commits':<10}",
        '-' * 60,
    ]
    
    if not contributors:
        lines.append('No contributor data available.')
        return '\n'.join(lines)
    
    for rank, (contributor, count) in enumerate(contributors, 1):
        name = contributor.split(' <')[0]
        lines.append(f"{rank:<6} {name:<45} {count:<10}")
    
    return '\n'.join(lines)


def format_heatmap(activity):
    lines = [
        '\n' + '=' * 60,
        'Weekly Commit Activity Heatmap',
        '=' * 60,
        '',
    ]
    
    if not activity:
        lines.append('No activity data available.')
        return '\n'.join(lines)
    
    all_commits = []
    for weekday, hours in activity.items():
        for hour, count in hours.items():
            all_commits.append((weekday, hour, count))
    
    if not all_commits:
        lines.append('No activity data available.')
        return '\n'.join(lines)
    
    max_count = max(count for _, _, count in all_commits)
    
    lines.append(f"{'Hour':<10} " + ' '.join(f"{d:<10}" for d in WEEKDAY_NAMES))
    lines.append('-' * 90)
    
    for hour in range(24):
        row = [f"{hour:02d}:00    "]
        for weekday in range(7):
            count = activity.get(weekday, {}).get(hour, 0)
            if max_count > 0:
                intensity = int((count / max_count) * 5)
            else:
                intensity = 0
            char = ' .:oO#'[intensity]
            row.append(f"{char} {count:<7}")
        lines.append(' '.join(row))
    
    peak_commit = max(all_commits, key=lambda x: x[2])
    lines.append('\n')
    lines.append(f"Peak activity: {WEEKDAY_NAMES[peak_commit[0]]} at {peak_commit[1]:02d}:00 "
                 f"with {peak_commit[2]} commits")
    
    return '\n'.join(lines)


def format_review_analysis(review_data):
    lines = [
        '\n' + '=' * 60,
        'Code Review Analysis',
        '=' * 60,
    ]
    
    if not review_data:
        lines.append('No review data available.')
        return '\n'.join(lines)
    
    lines.extend([
        f"Total commits analyzed: {review_data['total_commits']}",
        f"Commits with review tags: {review_data['reviewed_count']}",
        f"Review coverage ratio: {review_data['review_ratio']:.1%}",
    ])
    
    if review_data['reviewed_count'] > 0:
        lines.extend([
            f"Average review time: {review_data['average_review_days']} days "
            f"({review_data['average_review_hours']} hours)",
        ])
    else:
        lines.append("Note: No Reviewed-by tags found in commit messages.")
        lines.append("Review time analysis is based on 'Reviewed-by', 'Acked-by', or 'Tested-by' tags.")
    
    return '\n'.join(lines)


def generate_text_report(report_data):
    lines = [
        '=' * 60,
        'Git Insight Analysis Report',
        '=' * 60,
        f"Generated: {report_data.get('generated_at', 'N/A')}",
        f"Repository: {report_data.get('repo_path', 'N/A')}",
        f"Time range: Since {report_data.get('time_range', 'N/A')}",
    ]
    
    file_pattern = report_data.get('file_pattern')
    if file_pattern:
        lines.append(f"File pattern: {file_pattern}")
    
    lines.append(f"Total commits: {report_data.get('total_commits', 0)}")
    
    if 'error' in report_data:
        lines.append(f"\nError: {report_data['error']}")
        return '\n'.join(lines)
    
    lines.append(format_contributors(report_data.get('contributors', [])))
    lines.append(format_heatmap(report_data.get('weekly_activity', {})))
    lines.append(format_review_analysis(report_data.get('review_analysis', {})))
    
    lines.append('\n' + '=' * 60)
    lines.append('End of Report')
    lines.append('=' * 60)
    
    return '\n'.join(lines)
