import re
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Tuple, Optional

from git import Repo, Commit


class GitAnalyzer:
    def __init__(self, repo_path: str = '.'):
        self.repo_path = Path(repo_path)
        if not self.repo_path.exists():
            raise ValueError(f"Repository path does not exist: {repo_path}")
        
        try:
            self.repo = Repo(str(self.repo_path))
        except Exception as e:
            raise ValueError(f"Not a valid Git repository: {e}")

    def parse_since(self, since_str: str) -> datetime:
        now = datetime.now()
        
        if since_str == "now":
            return now
        
        match = re.match(r'(\d+)\s+(day|week|month|year)s?\s+ago', since_str.lower())
        if match:
            value = int(match.group(1))
            unit = match.group(2)
            
            if unit == 'day':
                delta = timedelta(days=value)
            elif unit == 'week':
                delta = timedelta(weeks=value)
            elif unit == 'month':
                delta = timedelta(days=value * 30)
            elif unit == 'year':
                delta = timedelta(days=value * 365)
            else:
                raise ValueError(f"Unknown time unit: {unit}")
            
            return now - delta
        
        try:
            return datetime.strptime(since_str, '%Y-%m-%d')
        except ValueError:
            pass
        
        try:
            return datetime.strptime(since_str, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            raise ValueError(f"Could not parse time string: {since_str}")

    @staticmethod
    def is_merge_commit(commit: Commit) -> bool:
        return len(commit.parents) > 1

    @staticmethod
    def get_commit_files(commit: Commit) -> List[str]:
        if commit.parents:
            parent = commit.parents[0]
            diffs = parent.diff(commit)
            files = []
            for diff in diffs:
                if diff.a_path:
                    files.append(diff.a_path)
                if diff.b_path and diff.b_path != diff.a_path:
                    files.append(diff.b_path)
            return list(set(files))
        else:
            return list(commit.stats.files.keys())

    @staticmethod
    def matches_file_pattern(file_path: str, pattern: Optional[str]) -> bool:
        if pattern is None:
            return True
        try:
            return re.match(pattern, file_path) is not None
        except re.error:
            return True

    def get_commits_since(self, since: str, include_merges: bool = False) -> List[Commit]:
        since_date = self.parse_since(since)
        since_timestamp = int(since_date.timestamp())
        
        commits = []
        for commit in self.repo.iter_commits():
            if commit.committed_date >= since_timestamp:
                if include_merges or not self.is_merge_commit(commit):
                    commits.append(commit)
            else:
                break
        
        return commits

    def analyze_contributors(self, commits: List[Commit], top_n: int, file_pattern: Optional[str] = None) -> List[Tuple[str, int]]:
        contributor_counts = defaultdict(int)
        
        for commit in commits:
            if file_pattern is not None:
                files = self.get_commit_files(commit)
                if not any(self.matches_file_pattern(f, file_pattern) for f in files):
                    continue
            
            author = f"{commit.author.name} <{commit.author.email}>"
            contributor_counts[author] += 1
        
        sorted_contributors = sorted(
            contributor_counts.items(),
            key=lambda x: (-x[1], x[0])
        )
        
        return sorted_contributors[:top_n]

    def analyze_weekly_activity(self, commits: List[Commit], file_pattern: Optional[str] = None) -> Dict[int, Dict[int, int]]:
        activity = defaultdict(lambda: defaultdict(int))
        
        for commit in commits:
            if file_pattern is not None:
                files = self.get_commit_files(commit)
                if not any(self.matches_file_pattern(f, file_pattern) for f in files):
                    continue
            
            commit_datetime = datetime.fromtimestamp(commit.committed_date)
            weekday = commit_datetime.weekday()
            hour = commit_datetime.hour
            activity[weekday][hour] += 1
        
        return dict(activity)

    def parse_review_tags(self, message: str) -> List[str]:
        patterns = [
            r'Reviewed-by:\s*(.*?)(?:\n|$)',
            r'Reviewed\s+by:\s*(.*?)(?:\n|$)',
            r'Acked-by:\s*(.*?)(?:\n|$)',
            r'Tested-by:\s*(.*?)(?:\n|$)',
        ]
        
        reviewers = []
        for pattern in patterns:
            matches = re.findall(pattern, message, re.IGNORECASE)
            reviewers.extend([m.strip() for m in matches if m.strip()])
        
        return reviewers

    def analyze_review_time(self, commits: List[Commit], file_pattern: Optional[str] = None) -> Dict:
        review_deltas = []
        reviewed_count = 0
        total_commits = 0
        
        for commit in commits:
            if file_pattern is not None:
                files = self.get_commit_files(commit)
                if not any(self.matches_file_pattern(f, file_pattern) for f in files):
                    continue
            
            total_commits += 1
            reviewers = self.parse_review_tags(commit.message)
            if reviewers:
                reviewed_count += 1
                
                author_date = datetime.fromtimestamp(commit.authored_date)
                commit_date = datetime.fromtimestamp(commit.committed_date)
                delta = commit_date - author_date
                
                if delta.total_seconds() >= 0:
                    review_deltas.append(delta)
        
        if review_deltas:
            total_seconds = sum(d.total_seconds() for d in review_deltas)
            average_seconds = total_seconds / len(review_deltas)
            average_days = average_seconds / 86400
        else:
            average_days = 0
        
        return {
            'reviewed_count': reviewed_count,
            'total_commits': total_commits,
            'review_ratio': (reviewed_count / total_commits) if total_commits > 0 else 0,
            'average_review_days': round(average_days, 2),
            'average_review_hours': round(average_seconds / 3600, 2) if review_deltas else 0,
        }

    def generate_report(
        self,
        since: str,
        top_n: int,
        include_merges: bool = False,
        file_pattern: Optional[str] = None
    ) -> Dict:
        commits = self.get_commits_since(since, include_merges=include_merges)
        
        if not commits:
            return {
                'error': 'No commits found in the specified time range.',
                'time_range': since,
                'file_pattern': file_pattern,
                'total_commits': 0,
            }
        
        return {
            'time_range': since,
            'file_pattern': file_pattern,
            'total_commits': len(commits),
            'contributors': self.analyze_contributors(commits, top_n, file_pattern=file_pattern),
            'weekly_activity': self.analyze_weekly_activity(commits, file_pattern=file_pattern),
            'review_analysis': self.analyze_review_time(commits, file_pattern=file_pattern),
        }
