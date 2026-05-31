#!/usr/bin/env python3
import os
import sys
import unittest

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)


class TestLMWrapper(unittest.TestCase):
    def test_import_without_crash(self):
        try:
            from python import lm_wrapper
            print("[OK] Import succeeded without crash")
            self.assertTrue(True)
        except Exception as e:
            self.fail(f"Import crashed: {e}")
    
    def test_singleton_instance(self):
        from python.lm_wrapper import LMWrapper
        
        instance1 = LMWrapper()
        instance2 = LMWrapper()
        
        self.assertIs(instance1, instance2)
        print("[OK] Singleton pattern works correctly")
    
    def test_library_status_before_load(self):
        from python.lm_wrapper import get_library_status
        
        status = get_library_status()
        
        self.assertIn('loaded', status)
        self.assertIn('path', status)
        self.assertIn('error', status)
        print(f"[OK] Library status available: loaded={status['loaded']}")
        if status['error']:
            print(f"  Library error: {status['error']}")
    
    def test_wrapper_methods_exist(self):
        from python.lm_wrapper import (
            LMWrapper,
            fit_curve_wrapper,
            is_library_available,
            get_library_status
        )
        
        wrapper = LMWrapper()
        
        self.assertTrue(hasattr(wrapper, 'ensure_loaded'))
        self.assertTrue(hasattr(wrapper, 'is_loaded'))
        self.assertTrue(hasattr(wrapper, 'fit_curve'))
        self.assertTrue(hasattr(wrapper, 'get_lib_path'))
        print("[OK] All wrapper methods exist")
    
    def test_worker_import_without_crash(self):
        try:
            from python import worker
            print("[OK] Worker import succeeded without crash")
            self.assertTrue(True)
        except ImportError as e:
            if 'redis' in str(e).lower() or 'rq' in str(e).lower():
                print("[SKIP] Worker import failed due to missing redis/rq (expected in test env)")
                self.skipTest("Missing optional dependencies: redis, rq")
            else:
                self.fail(f"Worker import crashed: {e}")
        except Exception as e:
            self.fail(f"Worker import crashed: {e}")
    
    def test_worker_function_exists(self):
        try:
            from python.worker import (
                process_fit_task,
                get_redis_connection,
                start_worker
            )
            
            self.assertTrue(callable(process_fit_task))
            self.assertTrue(callable(get_redis_connection))
            self.assertTrue(callable(start_worker))
            print("[OK] Worker functions exist")
        except ImportError as e:
            if 'redis' in str(e).lower() or 'rq' in str(e).lower():
                print("[SKIP] Skipping worker test due to missing redis/rq")
                self.skipTest("Missing optional dependencies: redis, rq")
            else:
                raise
    
    def test_main_import_without_crash(self):
        try:
            from python import main
            print("[OK] Main import succeeded without crash")
            self.assertTrue(True)
        except ImportError as e:
            if 'redis' in str(e).lower() or 'rq' in str(e).lower() or 'fastapi' in str(e).lower():
                print("[SKIP] Main import failed due to missing web dependencies (expected in test env)")
                self.skipTest("Missing optional dependencies: fastapi, redis, rq")
            else:
                self.fail(f"Main import crashed: {e}")
        except Exception as e:
            self.fail(f"Main import crashed: {e}")
    
    def test_app_exists(self):
        try:
            from python.main import app
            
            self.assertIsNotNone(app)
            print("[OK] FastAPI app exists")
        except ImportError as e:
            if 'redis' in str(e).lower() or 'rq' in str(e).lower() or 'fastapi' in str(e).lower():
                print("[SKIP] Skipping app test due to missing web dependencies")
                self.skipTest("Missing optional dependencies: fastapi, redis, rq")
            else:
                raise
    
    def test_routes_exist(self):
        try:
            from python.main import app
            
            routes = [route.path for route in app.routes]
            
            self.assertIn('/', routes)
            self.assertIn('/fit', routes)
            self.assertIn('/result/{task_id}', routes)
            self.assertIn('/health', routes)
            self.assertIn('/library-status', routes)
            print(f"[OK] All routes exist: {routes}")
        except ImportError as e:
            if 'redis' in str(e).lower() or 'rq' in str(e).lower() or 'fastapi' in str(e).lower():
                print("[SKIP] Skipping routes test due to missing web dependencies")
                self.skipTest("Missing optional dependencies: fastapi, redis, rq")
            else:
                raise
    
    def test_fit_curve_wrapper_returns_dict(self):
        from python.lm_wrapper import fit_curve_wrapper
        
        result = fit_curve_wrapper(
            x=[0.0, 1.0, 2.0],
            y=[1.0, 2.0, 3.0],
            func_expression="a * x + b"
        )
        
        self.assertIsInstance(result, dict)
        self.assertIn('success', result)
        self.assertIn('params', result)
        self.assertIn('chi_squared', result)
        self.assertIn('iterations', result)
        self.assertIn('error_message', result)
        print(f"[OK] fit_curve_wrapper returns proper dict structure")
        print(f"  success={result['success']}")
        if result['error_message']:
            print(f"  error={result['error_message'][:100]}")
    
    def test_process_fit_task_returns_dict(self):
        try:
            from python.worker import process_fit_task
            
            result = process_fit_task(
                x=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
                y=[5.0, 3.5, 2.5, 1.8, 1.3, 1.0],
                func_expression="a * exp(-b * x) + c"
            )
            
            self.assertIsInstance(result, dict)
            self.assertIn('status', result)
            self.assertIn('timestamp', result)
            self.assertIn('success', result)
            print(f"[OK] process_fit_task returns proper dict structure")
            print(f"  status={result['status']}")
            print(f"  success={result['success']}")
            if result.get('error_message'):
                print(f"  error={result['error_message'][:100]}")
        except ImportError as e:
            if 'redis' in str(e).lower() or 'rq' in str(e).lower():
                print("[SKIP] Skipping process_fit_task test due to missing redis/rq")
                self.skipTest("Missing optional dependencies: redis, rq")
            else:
                raise


def run_all_tests():
    print("=" * 60)
    print("Testing C++ Library Symbol Export Fix")
    print("=" * 60)
    
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(TestLMWrapper)
    
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    print("\n" + "=" * 60)
    passed = result.testsRun - len(result.failures) - len(result.errors) - len(getattr(result, 'skipped', []))
    total = result.testsRun
    skipped = len(getattr(result, 'skipped', []))
    
    if result.wasSuccessful() or (len(result.failures) == 0 and len(result.errors) == 0):
        print(f"[OK] All tests passed! (passed={passed}, skipped={skipped}, total={total})")
        print("\nKey fixes verified:")
        print("  1. Import does not crash (lazy loading works)")
        print("  2. Library can be checked without loading")
        print("  3. Wrapper methods are properly defined")
        print("  4. Functions return proper error responses")
    else:
        print(f"[FAIL] Tests failed: {len(result.failures)} failures, {len(result.errors)} errors")
    print("=" * 60)
    
    return len(result.failures) == 0 and len(result.errors) == 0


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
