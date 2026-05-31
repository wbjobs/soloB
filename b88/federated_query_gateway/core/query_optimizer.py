import sqlglot
from sqlglot import exp, parse_one
from typing import List, Dict, Any, Optional, Tuple, Set
import re
from dataclasses import dataclass


@dataclass
class TableReference:
    name: str
    datasource: str
    alias: Optional[str] = None


@dataclass
class FilterCondition:
    column: str
    operator: str
    value: Any
    raw_sql: str


@dataclass
class JoinCondition:
    left_table: str
    right_table: str
    left_column: str
    right_column: str
    join_type: str = "INNER"


@dataclass
class OptimizedQuery:
    original_sql: str
    tables: List[TableReference]
    filters: Dict[str, List[FilterCondition]]
    joins: List[JoinCondition]
    select_columns: List[str]
    group_by: List[str]
    order_by: List[Tuple[str, str]]
    limit: Optional[int]
    pushdown_queries: Dict[str, str]


class QueryOptimizer:
    def __init__(self, datasource_mapping: Dict[str, str]):
        self.datasource_mapping = datasource_mapping
        self.supported_operators = {'=', '>', '>=', '<', '<=', '!=', '<>', 'IN', 'LIKE', 'NOT IN'}

    def parse_and_optimize(self, sql: str) -> OptimizedQuery:
        parsed = parse_one(sql)
        
        tables = self._extract_tables(parsed)
        select_columns = self._extract_select_columns(parsed)
        filters = self._extract_filters(parsed, tables)
        joins = self._extract_joins(parsed)
        group_by = self._extract_group_by(parsed)
        order_by = self._extract_order_by(parsed)
        limit = self._extract_limit(parsed)
        
        pushdown_queries = self._generate_pushdown_queries(
            tables, filters, select_columns
        )
        
        return OptimizedQuery(
            original_sql=sql,
            tables=tables,
            filters=filters,
            joins=joins,
            select_columns=select_columns,
            group_by=group_by,
            order_by=order_by,
            limit=limit,
            pushdown_queries=pushdown_queries
        )

    def _extract_tables(self, parsed: exp.Expression) -> List[TableReference]:
        tables = []
        
        from_clause = parsed.find(exp.From)
        if from_clause:
            for table in from_clause.find_all(exp.Table):
                table_name = table.name
                alias = table.alias if table.alias else None
                
                datasource = self._map_to_datasource(table_name)
                
                tables.append(TableReference(
                    name=table_name,
                    datasource=datasource,
                    alias=alias
                ))
        
        joins = parsed.find_all(exp.Join)
        for join in joins:
            table = join.this
            if isinstance(table, exp.Table):
                table_name = table.name
                alias = table.alias if table.alias else None
                datasource = self._map_to_datasource(table_name)
                
                if not any(t.name == table_name for t in tables):
                    tables.append(TableReference(
                        name=table_name,
                        datasource=datasource,
                        alias=alias
                    ))
        
        return tables

    def _map_to_datasource(self, table_name: str) -> str:
        if table_name in self.datasource_mapping:
            return self.datasource_mapping[table_name]
        
        for prefix, ds in self.datasource_mapping.items():
            if table_name.startswith(f"{prefix}_"):
                return ds
        
        return "default"

    def _extract_select_columns(self, parsed: exp.Expression) -> List[str]:
        columns = []
        select = parsed.find(exp.Select)
        
        if select:
            for expr in select.expressions:
                if isinstance(expr, exp.Star):
                    columns.append("*")
                elif isinstance(expr, exp.Column):
                    col_name = expr.name
                    if expr.table:
                        col_name = f"{expr.table}.{col_name}"
                    columns.append(col_name)
                elif hasattr(expr, 'alias') and expr.alias:
                    columns.append(expr.alias)
                else:
                    columns.append(str(expr))
        
        return columns if columns else ["*"]

    def _extract_filters(self, parsed: exp.Expression, 
                         tables: List[TableReference]) -> Dict[str, List[FilterCondition]]:
        filters = {t.name: [] for t in tables}
        
        where = parsed.find(exp.Where)
        if not where:
            return filters
        
        def process_condition(condition: exp.Expression, table_context: Optional[str] = None):
            if isinstance(condition, exp.And) or isinstance(condition, exp.Or):
                process_condition(condition.left, table_context)
                process_condition(condition.right, table_context)
                return
            
            if isinstance(condition, exp.Paren):
                process_condition(condition.this, table_context)
                return
            
            if isinstance(condition, exp.Binary):
                left = condition.left
                op = condition.args.get('operator', '')
                right = condition.right
                
                if isinstance(left, exp.Column):
                    table_name = left.table or table_context
                    column_name = left.name
                    
                    if table_name:
                        table_map = {t.alias or t.name: t.name for t in tables}
                        actual_table = table_map.get(table_name, table_name)
                        
                        if actual_table in filters:
                            value = self._extract_value(right)
                            filters[actual_table].append(FilterCondition(
                                column=column_name,
                                operator=op.upper(),
                                value=value,
                                raw_sql=str(condition)
                            ))

        process_condition(where.this)
        return filters

    def _extract_value(self, expr: exp.Expression) -> Any:
        if isinstance(expr, exp.Literal):
            return expr.this
        elif isinstance(expr, exp.Number):
            try:
                return int(expr.this)
            except ValueError:
                return float(expr.this)
        elif isinstance(expr, exp.Boolean):
            return expr.this
        elif isinstance(expr, exp.Null):
            return None
        elif isinstance(expr, exp.Tuple):
            return [self._extract_value(e) for e in expr.expressions]
        return str(expr)

    def _extract_joins(self, parsed: exp.Expression) -> List[JoinCondition]:
        joins = []
        table_map = {}
        
        from_clause = parsed.find(exp.From)
        if from_clause:
            for table in from_clause.find_all(exp.Table):
                alias = table.alias or table.name
                table_map[alias] = table.name
        
        for join in parsed.find_all(exp.Join):
            right_table = join.this
            if isinstance(right_table, exp.Table):
                right_name = right_table.alias or right_table.name
                right_actual = right_table.name
                
                on_clause = join.args.get('on')
                if on_clause:
                    left_col, right_col = self._parse_join_condition(on_clause)
                    if left_col and right_col:
                        left_table = left_col.split('.')[0] if '.' in left_col else None
                        
                        if left_table and left_table in table_map:
                            left_actual = table_map[left_table]
                            joins.append(JoinCondition(
                                left_table=left_actual,
                                right_table=right_actual,
                                left_column=left_col.split('.')[-1] if '.' in left_col else left_col,
                                right_column=right_col.split('.')[-1] if '.' in right_col else right_col,
                                join_type=join.args.get('kind', 'INNER').upper()
                            ))
        
        return joins

    def _parse_join_condition(self, on_clause: exp.Expression) -> Tuple[Optional[str], Optional[str]]:
        if isinstance(on_clause, exp.EQ):
            left = on_clause.left
            right = on_clause.right
            
            if isinstance(left, exp.Column) and isinstance(right, exp.Column):
                left_name = f"{left.table}.{left.name}" if left.table else left.name
                right_name = f"{right.table}.{right.name}" if right.table else right.name
                return left_name, right_name
        
        return None, None

    def _extract_group_by(self, parsed: exp.Expression) -> List[str]:
        group_by = parsed.find(exp.Group)
        if not group_by:
            return []
        
        columns = []
        for expr in group_by.expressions:
            if isinstance(expr, exp.Column):
                col_name = expr.name
                if expr.table:
                    col_name = f"{expr.table}.{col_name}"
                columns.append(col_name)
        
        return columns

    def _extract_order_by(self, parsed: exp.Expression) -> List[Tuple[str, str]]:
        order = parsed.find(exp.Order)
        if not order:
            return []
        
        result = []
        for ordered in order.expressions:
            if isinstance(ordered, exp.Ordered):
                col = ordered.this
                direction = ordered.args.get('direction', 'ASC')
                if isinstance(col, exp.Column):
                    col_name = col.name
                    if col.table:
                        col_name = f"{col.table}.{col_name}"
                    result.append((col_name, direction.upper()))
        
        return result

    def _extract_limit(self, parsed: exp.Expression) -> Optional[int]:
        limit = parsed.find(exp.Limit)
        if limit and limit.expression:
            try:
                return int(limit.expression.this)
            except (ValueError, AttributeError):
                pass
        return None

    def _generate_pushdown_queries(self, 
                                    tables: List[TableReference],
                                    filters: Dict[str, List[FilterCondition]],
                                    select_columns: List[str]
                                    ) -> Dict[str, str]:
        pushdown_queries = {}
        
        for table in tables:
            table_filters = filters.get(table.name, [])
            columns = self._get_columns_for_table(select_columns, table)
            
            where_clause = ""
            if table_filters:
                conditions = []
                for f in table_filters:
                    if f.value is None:
                        conditions.append(f"{f.column} IS NULL")
                    elif isinstance(f.value, list):
                        placeholders = ', '.join([self._format_value(v) for v in f.value])
                        conditions.append(f"{f.column} IN ({placeholders})")
                    else:
                        conditions.append(f"{f.column} {f.operator} {self._format_value(f.value)}")
                
                where_clause = " WHERE " + " AND ".join(conditions)
            
            query = f"SELECT {', '.join(columns)} FROM {table.name}{where_clause}"
            pushdown_queries[table.name] = query
        
        return pushdown_queries

    def _get_columns_for_table(self, columns: List[str], table: TableReference) -> List[str]:
        if "*" in columns:
            return ["*"]
        
        table_aliases = [table.name]
        if table.alias:
            table_aliases.append(table.alias)
        
        result = []
        for col in columns:
            if '.' in col:
                prefix = col.split('.')[0]
                if prefix in table_aliases:
                    result.append(col.split('.')[-1])
            else:
                result.append(col)
        
        return result if result else ["*"]

    def _format_value(self, value: Any) -> str:
        if isinstance(value, str):
            return f"'{value}'"
        elif value is None:
            return "NULL"
        elif isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        else:
            return str(value)

    def can_pushdown_filter(self, condition: FilterCondition, datasource: str) -> bool:
        if condition.operator not in self.supported_operators:
            return False
        
        if isinstance(condition.value, list) and len(condition.value) > 1000:
            return False
        
        return True

    def validate_query(self, sql: str) -> Tuple[bool, List[str]]:
        errors = []
        
        try:
            parsed = parse_one(sql)
            
            if not parsed.find(exp.Select):
                errors.append("Only SELECT queries are supported")
            
            tables = self._extract_tables(parsed)
            if not tables:
                errors.append("No tables found in query")
            
            for table in tables:
                if table.datasource == "default":
                    errors.append(f"Unknown datasource for table: {table.name}")
            
            return len(errors) == 0, errors
            
        except Exception as e:
            errors.append(f"SQL parsing error: {str(e)}")
            return False, errors
