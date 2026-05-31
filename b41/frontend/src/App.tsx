import React, { useState, useEffect } from 'react';
import FileUpload from './components/FileUpload';
import ProgressBar from './components/ProgressBar';
import AlignmentResult from './components/AlignmentResult';
import { uploadFiles, getTasks } from './api';
import { AlignmentResult as AlignmentResultType, AlignmentTask } from './types';

type AppState = 'idle' | 'processing' | 'result' | 'error';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>('idle');
  const [progress, setProgress] = useState({ step: 0, total: 4, message: '准备就绪' });
  const [result, setResult] = useState<AlignmentResultType | null>(null);
  const [taskId, setTaskId] = useState<string>('');
  const [fileNames, setFileNames] = useState({ file1: '', file2: '' });
  const [error, setError] = useState<string>('');
  const [tasks, setTasks] = useState<AlignmentTask[]>([]);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      const data = await getTasks();
      setTasks(data);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
  };

  const handleFilesSelected = async (file1: File, file2: File) => {
    setState('processing');
    setError('');
    setFileNames({ file1: file1.name, file2: file2.name });
    setProgress({ step: 1, total: 5, message: '上传文件' });

    try {
      const response = await uploadFiles(file1, file2);
      
      if (response.result.progress && response.result.progress.length > 0) {
        for (const progressItem of response.result.progress) {
          setProgress({ 
            step: progressItem.step, 
            total: response.result.progress.length,
            message: progressItem.message 
          });
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } else {
        setProgress({ step: 5, total: 5, message: '完成比对' });
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      setResult(response.result);
      setTaskId(response.task_id);
      setState('result');
      loadTasks();
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.response?.data?.detail || '上传或处理失败');
      setState('error');
    }
  };

  const handleReset = () => {
    setState('idle');
    setResult(null);
    setTaskId('');
    setProgress({ step: 0, total: 4, message: '准备就绪' });
    setFileNames({ file1: '', file2: '' });
    setError('');
  };

  const handleShowTask = (task: AlignmentTask) => {
    const mockResult: AlignmentResultType = {
      aligned_a: task.aligned_a,
      aligned_b: task.aligned_b,
      alignment_string: task.alignment_string,
      score: task.final_score,
      progress: [],
    };
    setResult(mockResult);
    setTaskId(task.task_id);
    setFileNames({ file1: task.file_name_a, file2: task.file_name_b });
    setState('result');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">
                🧬 DNA序列比对工具
              </h1>
              <p className="text-gray-600 mt-1">
                Needleman-Wunsch 全局比对算法
              </p>
            </div>
            {state !== 'idle' && (
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg
                  hover:bg-gray-700 transition-colors"
              >
                重新开始
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-8 px-4">
        {state === 'idle' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <FileUpload
                onFilesSelected={handleFilesSelected}
                disabled={false}
              />
            </div>
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  历史任务
                </h3>
                {tasks.length === 0 ? (
                  <p className="text-gray-500 text-sm">暂无历史任务</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {tasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => handleShowTask(task)}
                        className="w-full text-left p-3 rounded-lg hover:bg-gray-50
                          transition-colors border border-gray-200"
                      >
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {task.file_name_a} vs {task.file_name_b}
                        </p>
                        <div className="flex justify-between mt-1 text-xs text-gray-500">
                          <span>得分: {task.final_score}</span>
                          <span>
                            {new Date(task.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {state === 'processing' && (
          <div className="flex items-center justify-center min-h-96">
            <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full
                  flex items-center justify-center">
                  <svg className="animate-spin h-8 w-8 text-blue-600"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2
                        5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824
                        3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-800">
                  正在处理...
                </h3>
              </div>
              <ProgressBar
                step={progress.step}
                total={progress.total}
                message={progress.message}
              />
            </div>
          </div>
        )}

        {state === 'result' && result && (
          <AlignmentResult
            result={result}
            taskId={taskId}
            fileName1={fileNames.file1}
            fileName2={fileNames.file2}
          />
        )}

        {state === 'error' && (
          <div className="flex items-center justify-center min-h-96">
            <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md
              text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full
                flex items-center justify-center">
                <svg className="h-8 w-8 text-red-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54
                      0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464
                      0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">
                出错了
              </h3>
              <p className="text-gray-600 mb-6">{error}</p>
              <button
                onClick={handleReset}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg
                  hover:bg-blue-700 transition-colors font-semibold"
              >
                重新开始
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white border-t mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-gray-500
          text-sm">
          <p>DNA序列比对工具 - 基于Needleman-Wunsch算法</p>
          <p className="mt-1">支持FASTA格式文件上传</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
