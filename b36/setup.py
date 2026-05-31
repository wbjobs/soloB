from setuptools import setup, find_packages

setup(
    name='git-insight',
    version='0.1.0',
    description='A command-line tool for analyzing Git repository history',
    packages=find_packages(),
    install_requires=[
        'click>=8.0',
        'gitpython>=3.1',
    ],
    entry_points='''
        [console_scripts]
        git-insight=git_insight.cli:cli
    ''',
    python_requires='>=3.8',
)
