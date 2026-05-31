#!/usr/bin/env python3
import os
from datetime import datetime, timedelta
from flask import Flask, jsonify, request
from flask_cors import CORS
from elasticsearch import Elasticsearch
from dateutil.parser import parse as parse_date

app = Flask(__name__)
CORS(app)

ES_HOSTS = os.environ.get('ES_HOSTS', 'http://localhost:9200').split(',')
ES_INDEX = os.environ.get('ES_INDEX', 'syscall-aggregations')

es = Elasticsearch(ES_HOSTS)

SYSCALL_TYPES = ['open', 'openat', 'read', 'write', 'connect', 'close']


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'elasticsearch': {
            'connected': es.ping(),
            'hosts': ES_HOSTS,
            'index': ES_INDEX
        }
    })


@app.route('/api/syscalls', methods=['GET'])
def get_syscall_frequency():
    tgid = request.args.get('tgid', type=int)
    syscall = request.args.get('syscall', default=None)
    start_time = request.args.get('start_time')
    end_time = request.args.get('end_time')
    last_minutes = request.args.get('last_minutes', default=5, type=int)
    
    if not end_time:
        end_time = datetime.utcnow()
    else:
        end_time = parse_date(end_time)
    
    if not start_time:
        start_time = end_time - timedelta(minutes=last_minutes)
    else:
        start_time = parse_date(start_time)
    
    query = {
        'query': {
            'bool': {
                'filter': [
                    {
                        'range': {
                            'windowStart': {
                                'gte': start_time.timestamp() * 1000,
                                'lte': end_time.timestamp() * 1000
                            }
                        }
                    }
                ]
            }
        },
        'sort': [
            {'windowStart': {'order': 'asc'}}
        ],
        'size': 10000
    }
    
    if tgid:
        query['query']['bool']['filter'].append({
            'term': {'tgid': tgid}
        })
    
    if syscall:
        query['query']['bool']['filter'].append({
            'term': {'syscall': syscall}
        })
    
    try:
        response = es.search(index=ES_INDEX, body=query)
        
        results = []
        for hit in response['hits']['hits']:
            source = hit['_source']
            results.append({
                'timestamp': source.get('timestamp'),
                'tgid': source.get('tgid'),
                'syscall': source.get('syscall'),
                'count': source.get('count'),
                'windowStart': source.get('windowStart'),
                'windowEnd': source.get('windowEnd')
            })
        
        return jsonify({
            'success': True,
            'count': len(results),
            'data': results
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/syscalls/by-syscall', methods=['GET'])
def get_syscall_frequency_by_syscall():
    tgid = request.args.get('tgid', type=int)
    start_time = request.args.get('start_time')
    end_time = request.args.get('end_time')
    last_minutes = request.args.get('last_minutes', default=5, type=int)
    
    if not end_time:
        end_time = datetime.utcnow()
    else:
        end_time = parse_date(end_time)
    
    if not start_time:
        start_time = end_time - timedelta(minutes=last_minutes)
    else:
        start_time = parse_date(start_time)
    
    query = {
        'query': {
            'bool': {
                'filter': [
                    {
                        'range': {
                            'windowStart': {
                                'gte': start_time.timestamp() * 1000,
                                'lte': end_time.timestamp() * 1000
                            }
                        }
                    }
                ]
            }
        },
        'aggs': {
            'by_syscall': {
                'terms': {
                    'field': 'syscall',
                    'size': 100
                },
                'aggs': {
                    'total_count': {
                        'sum': {
                            'field': 'count'
                        }
                    }
                }
            }
        },
        'size': 0
    }
    
    if tgid:
        query['query']['bool']['filter'].append({
            'term': {'tgid': tgid}
        })
    
    try:
        response = es.search(index=ES_INDEX, body=query)
        
        results = []
        for bucket in response['aggregations']['by_syscall']['buckets']:
            results.append({
                'syscall': bucket['key'],
                'count': bucket['total_count']['value']
            })
        
        return jsonify({
            'success': True,
            'data': results
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/processes', methods=['GET'])
def get_monitored_processes():
    query = {
        'query': {
            'match_all': {}
        },
        'aggs': {
            'by_tgid': {
                'terms': {
                    'field': 'tgid',
                    'size': 100
                },
                'aggs': {
                    'last_activity': {
                        'max': {
                            'field': 'timestamp'
                        }
                    }
                }
            }
        },
        'size': 0
    }
    
    try:
        response = es.search(index=ES_INDEX, body=query)
        
        processes = []
        for bucket in response['aggregations']['by_tgid']['buckets']:
            processes.append({
                'tgid': bucket['key'],
                'doc_count': bucket['doc_count'],
                'last_activity': bucket['last_activity']['value']
            })
        
        return jsonify({
            'success': True,
            'data': processes
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/syscalls/timeline', methods=['GET'])
def get_syscall_timeline():
    tgid = request.args.get('tgid', type=int)
    syscalls = request.args.getlist('syscall')
    start_time = request.args.get('start_time')
    end_time = request.args.get('end_time')
    last_minutes = request.args.get('last_minutes', default=5, type=int)
    interval_ms = request.args.get('interval', default=1000, type=int)
    
    if not end_time:
        end_time = datetime.utcnow()
    else:
        end_time = parse_date(end_time)
    
    if not start_time:
        start_time = end_time - timedelta(minutes=last_minutes)
    else:
        start_time = parse_date(start_time)
    
    filters = [
        {
            'range': {
                'windowStart': {
                    'gte': start_time.timestamp() * 1000,
                    'lte': end_time.timestamp() * 1000
                }
            }
        }
    ]
    
    if tgid:
        filters.append({'term': {'tgid': tgid}})
    
    if syscalls:
        filters.append({'terms': {'syscall': syscalls}})
    
    query = {
        'query': {
            'bool': {
                'filter': filters
            }
        },
        'aggs': {
            'time_buckets': {
                'date_histogram': {
                    'field': 'windowStart',
                    'interval': f'{interval_ms}ms',
                    'format': 'epoch_millis'
                },
                'aggs': {
                    'by_syscall': {
                        'terms': {
                            'field': 'syscall',
                            'size': 100
                        },
                        'aggs': {
                            'total_count': {
                                'sum': {
                                    'field': 'count'
                                }
                            }
                        }
                    }
                }
            }
        },
        'size': 0
    }
    
    try:
        response = es.search(index=ES_INDEX, body=query)
        
        results = []
        for bucket in response['aggregations']['time_buckets']['buckets']:
            timestamp = bucket['key']
            syscall_data = {}
            for syscall_bucket in bucket['by_syscall']['buckets']:
                syscall_data[syscall_bucket['key']] = syscall_bucket['total_count']['value']
            
            result = {
                'timestamp': timestamp,
                'time_str': bucket['key_as_string']
            }
            
            for syscall in SYSCALL_TYPES:
                result[syscall] = syscall_data.get(syscall, 0)
            
            results.append(result)
        
        return jsonify({
            'success': True,
            'data': results
        })
        
    except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
